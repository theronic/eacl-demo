"""Terminate overdue, explicitly managed EACL demo temporary EC2 instances."""

import datetime
import json
import os
import re

import boto3


PROJECT = "eacl-demo"
MANAGED_BY = "eacl-demo-temp-watchdog"
MAX_MATCHING_INSTANCES = 100
MAX_RUNTIME = datetime.timedelta(minutes=360)
PURPOSES = {"datahike-seed", "datomic-seed", "datomic-transactor", "jank-build"}
INSTANCE_ID = re.compile(r"^i-[0-9a-f]{8,32}$")
AUTHORIZATION_ID = re.compile(r"^sha256:[0-9a-f]{64}$")


def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def _tags(instance):
    return {
        tag.get("Key"): tag.get("Value")
        for tag in instance.get("Tags", [])
        if isinstance(tag, dict) and isinstance(tag.get("Key"), str)
    }


def _expiry(value):
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _reason(instance, now):
    instance_id = instance.get("InstanceId")
    tags = _tags(instance)
    if not isinstance(instance_id, str) or not INSTANCE_ID.fullmatch(instance_id):
        raise RuntimeError("temporary compute inventory returned an invalid instance ID")
    if tags.get("Project") != PROJECT or tags.get("Lifecycle") != "temporary" or tags.get("ManagedBy") != MANAGED_BY:
        return None
    if tags.get("Owner") != "theronic/eacl-demo":
        return "invalid-owner"
    if tags.get("Purpose") not in PURPOSES:
        return "invalid-purpose"
    if not AUTHORIZATION_ID.fullmatch(tags.get("AuthorizationId", "")):
        return "invalid-authorization-id"
    launched_at = instance.get("LaunchTime")
    if not isinstance(launched_at, datetime.datetime) or launched_at.tzinfo is None:
        return "invalid-launch-time"
    expires_at = _expiry(tags.get("ExpiresAt"))
    if expires_at is None:
        return "invalid-expiry"
    if expires_at > launched_at + MAX_RUNTIME:
        return "expiry-exceeds-authorization"
    if expires_at <= now:
        return "expired"
    return None


def _instances(ec2):
    paginator = ec2.get_paginator("describe_instances")
    filters = [
        {"Name": "tag:Project", "Values": [PROJECT]},
        {"Name": "tag:Lifecycle", "Values": ["temporary"]},
        {"Name": "tag:ManagedBy", "Values": [MANAGED_BY]},
        {
            "Name": "instance-state-name",
            "Values": ["pending", "running", "stopping", "stopped"],
        },
    ]
    result = []
    for page in paginator.paginate(Filters=filters):
        for reservation in page.get("Reservations", []):
            result.extend(reservation.get("Instances", []))
            if len(result) > MAX_MATCHING_INSTANCES:
                raise RuntimeError("temporary compute inventory exceeds its safety bound")
    return result


def _notification(instance_id, purpose, reason, now):
    return json.dumps(
        {
            "AlarmName": "eacl-demo-temporary-compute-overdue",
            "NewStateValue": "ALARM",
            "NewStateReason": f"Terminated {instance_id}; reason={reason}; purpose={purpose}",
            "StateChangeTime": now.isoformat().replace("+00:00", "Z"),
            "Region": os.environ.get("AWS_REGION", "unknown"),
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def handler(event, context, *, ec2=None, sns=None, now=None):
    del event, context
    topic_arn = os.environ["ALARM_TOPIC_ARN"]
    if not re.fullmatch(r"arn:[a-z0-9-]+:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_.-]+", topic_arn):
        raise RuntimeError("alarm topic ARN is invalid")
    ec2 = ec2 or boto3.client("ec2")
    sns = sns or boto3.client("sns")
    now = now or _utc_now()
    overdue = []
    instances = _instances(ec2)
    for instance in instances:
        reason = _reason(instance, now)
        if reason:
            tags = _tags(instance)
            overdue.append((instance["InstanceId"], tags.get("Purpose", "unknown"), reason))

    terminated = []
    for instance_id, purpose, reason in overdue:
        ec2.terminate_instances(InstanceIds=[instance_id])
        terminated.append(instance_id)
        sns.publish(
            TopicArn=topic_arn,
            Subject="EACL demo temporary compute terminated",
            Message=_notification(instance_id, purpose, reason, now),
        )
        print(f"terminated temporary compute instance_id={instance_id} reason={reason}")
    return {"inspected": len(instances), "terminated": terminated}
