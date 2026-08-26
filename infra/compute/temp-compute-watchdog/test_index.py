import datetime
import importlib.util
import os
import pathlib
import sys
import types
import unittest
from unittest import mock


class _Paginator:
    def __init__(self, instances):
        self.instances = instances

    def paginate(self, **kwargs):
        if len(kwargs.get("Filters", [])) != 4:
            raise AssertionError(kwargs)
        return [{"Reservations": [{"Instances": self.instances}]}]


class _Ec2:
    def __init__(self, instances):
        self.instances = instances
        self.terminated = []

    def get_paginator(self, name):
        if name != "describe_instances":
            raise AssertionError(name)
        return _Paginator(self.instances)

    def terminate_instances(self, **kwargs):
        if len(kwargs.get("InstanceIds", [])) != 1:
            raise AssertionError(kwargs)
        self.terminated.append(kwargs["InstanceIds"][0])


class _Sns:
    def __init__(self):
        self.messages = []

    def publish(self, **kwargs):
        self.messages.append(kwargs)


def _load_module():
    with mock.patch.dict(sys.modules, {"boto3": types.SimpleNamespace(client=None)}):
        source = pathlib.Path(__file__).with_name("index.py")
        spec = importlib.util.spec_from_file_location("eacl_demo_temp_watchdog", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


def _instance(instance_id, expires_at, **overrides):
    launch_time = overrides.pop("LaunchTime", datetime.datetime(2026, 8, 25, 10, 0, tzinfo=datetime.timezone.utc))
    tags = {
        "Project": "eacl-demo",
        "Lifecycle": "temporary",
        "ManagedBy": "eacl-demo-temp-watchdog",
        "Owner": "theronic/eacl-demo",
        "Purpose": "datomic-transactor",
        "AuthorizationId": f"sha256:{'a' * 64}",
        "ExpiresAt": expires_at,
        **overrides,
    }
    return {"InstanceId": instance_id, "LaunchTime": launch_time, "Tags": [{"Key": key, "Value": value} for key, value in tags.items()]}


class WatchdogTest(unittest.TestCase):
    def setUp(self):
        self.module = _load_module()
        self.environment = {
            "ALARM_TOPIC_ARN": "arn:aws:sns:us-east-1:843761893873:eacl-demo-alarms",
            "AWS_REGION": "us-east-1",
        }
        self.now = datetime.datetime(2026, 8, 25, 12, 0, tzinfo=datetime.timezone.utc)

    def test_terminates_only_overdue_exact_ids_and_publishes_critical_messages(self):
        ec2 = _Ec2([
            _instance("i-0123456789abcdef0", "2026-08-25T11:59:00Z"),
            _instance("i-1123456789abcdef0", "2026-08-25T12:01:00Z"),
        ])
        sns = _Sns()
        with mock.patch.dict(os.environ, self.environment, clear=True), mock.patch("builtins.print"):
            result = self.module.handler({}, None, ec2=ec2, sns=sns, now=self.now)
        self.assertEqual(["i-0123456789abcdef0"], result["terminated"])
        self.assertEqual(result["terminated"], ec2.terminated)
        self.assertEqual(1, len(sns.messages))
        self.assertIn('"NewStateValue":"ALARM"', sns.messages[0]["Message"])
        self.assertNotIn("AuthorizationId", sns.messages[0]["Message"])

    def test_invalid_expiry_or_safety_tags_terminate_fail_closed(self):
        ec2 = _Ec2([
            _instance("i-2123456789abcdef0", "not-a-date"),
            _instance("i-3123456789abcdef0", "2026-08-25T13:00:00Z", Owner="other"),
            _instance("i-4123456789abcdef0", "2026-08-25T13:00:00Z", Purpose="unknown"),
            _instance("i-5123456789abcdef0", "2026-08-26T13:00:00Z"),
            _instance("i-6123456789abcdef0", "2026-08-25T13:00:00Z", LaunchTime=None),
        ])
        sns = _Sns()
        with mock.patch.dict(os.environ, self.environment, clear=True), mock.patch("builtins.print"):
            result = self.module.handler({}, None, ec2=ec2, sns=sns, now=self.now)
        self.assertEqual(5, len(result["terminated"]))
        self.assertEqual(5, len(sns.messages))

    def test_inventory_and_topic_are_bounded(self):
        ec2 = _Ec2([_instance(f"i-{index:017x}", "2026-08-25T13:00:00Z") for index in range(101)])
        with mock.patch.dict(os.environ, self.environment, clear=True):
            with self.assertRaisesRegex(RuntimeError, "safety bound"):
                self.module.handler({}, None, ec2=ec2, sns=_Sns(), now=self.now)
        invalid = dict(self.environment, ALARM_TOPIC_ARN="not-an-arn")
        with mock.patch.dict(os.environ, invalid, clear=True):
            with self.assertRaisesRegex(RuntimeError, "topic ARN"):
                self.module.handler({}, None, ec2=_Ec2([]), sns=_Sns(), now=self.now)


if __name__ == "__main__":
    unittest.main()
