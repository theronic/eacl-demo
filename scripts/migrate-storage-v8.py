"""CI-only copy/migrate/verify operation with exact reviewed resource identities."""
import concurrent.futures
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
PLAN = json.loads((ROOT / "infra/data/storage-v8-migration.json").read_text())
CONFIG = Config(region_name=PLAN["region"], retries={"mode": "standard", "max_attempts": 12},
                max_pool_connections=32)
BLOB = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.ksv")


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}), flush=True)


def client(service):
    return boto3.client(service, config=CONFIG)


def tags(profile, phase="migrating"):
    return [{"Key": k, "Value": v} for k, v in {
        "Project": "eacl-demo", "Profile": profile, "Generation": PLAN["generation"],
        "Workload": "eacl-demo-migration", "PublicationPhase": phase,
    }.items()]


def cost_preflight():
    active = client("ce").list_cost_allocation_tags(Status="Active", Type="UserDefined",
                                                     TagKeys=["Project", "Workload"])
    if {v["TagKey"] for v in active["CostAllocationTags"]} != {"Project", "Workload"}:
        raise RuntimeError("Project cost-allocation tags are not active")


def install_table_alarms(profile, target):
    cw = client("cloudwatch")
    for metric in ["ReadThrottleEvents", "WriteThrottleEvents", "SystemErrors"]:
        cw.put_metric_alarm(
            AlarmName=f"eacl-demo-storage-v8-{profile}-{metric}", Namespace="AWS/DynamoDB",
            MetricName=metric, Dimensions=[{"Name": "TableName", "Value": target}],
            Statistic="Sum", Period=60, EvaluationPeriods=3, DatapointsToAlarm=2,
            Threshold=10, ComparisonOperator="GreaterThanThreshold", TreatMissingData="notBreaching",
            AlarmActions=["arn:aws:sns:us-east-1:843761893873:eacl-demo-alarms"], OKActions=[])


def table_or_none(ddb, table):
    try:
        return ddb.describe_table(TableName=table)["Table"]
    except ddb.exceptions.ResourceNotFoundException:
        return None


def assert_target_unpublished(ddb, table):
    values = ddb.list_tags_of_resource(ResourceArn=table["TableArn"])["Tags"]
    values = {v["Key"]: v["Value"] for v in values}
    if values.get("Generation") != PLAN["generation"] or values.get("PublicationPhase") != "migrating":
        raise RuntimeError("Target is not an unpublished migration generation")


def create_datahike_table(ddb, profile, target):
    install_table_alarms(profile, target)
    current = table_or_none(ddb, target)
    if current:
        assert_target_unpublished(ddb, current)
        return
    ddb.create_table(TableName=target, KeySchema=[{"AttributeName": "Key", "KeyType": "HASH"}],
                     AttributeDefinitions=[{"AttributeName": "Key", "AttributeType": "S"}],
                     BillingMode="PAY_PER_REQUEST", DeletionProtectionEnabled=True,
                     OnDemandThroughput={"MaxReadRequestUnits": PLAN["migrationReadUnits"],
                                         "MaxWriteRequestUnits": PLAN["migrationWriteUnits"]},
                     Tags=tags(profile))
    ddb.get_waiter("table_exists").wait(TableName=target)
    ddb.update_continuous_backups(TableName=target,
                                  PointInTimeRecoverySpecification={"PointInTimeRecoveryEnabled": True})


def download_s3(source, store_id, directory):
    s3 = client("s3")
    prefix = store_id + "_"
    objects = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=source, Prefix=prefix):
        objects.extend(page.get("Contents", []))
    size = sum(o["Size"] for o in objects)
    if not objects or size > PLAN["maximumSourceBytes"]:
        raise RuntimeError("Source inventory absent or over reviewed size limit")

    def download(obj):
        name = obj["Key"][len(prefix):]
        if name == ".konserve-metadata":
            return
        if not BLOB.fullmatch(name):
            raise RuntimeError(f"Unexpected store object: {name}")
        response = s3.get_object(Bucket=source, Key=obj["Key"], IfMatch=obj["ETag"])
        with (directory / name).open("wb") as out:
            while chunk := response["Body"].read(1024 * 1024):
                out.write(chunk)
        if (directory / name).stat().st_size != obj["Size"]:
            raise RuntimeError("Incomplete source download")

    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        for index, _ in enumerate(pool.map(download, objects), 1):
            if index % 10000 == 0:
                emit("download-progress", objects=index)
    emit("source-copied", bytes=size, objects=len(objects))


def download_ddb(source, directory):
    ddb = client("dynamodb")
    arguments = {"TableName": source, "ConsistentRead": True,
                 "ReturnConsumedCapacity": "TOTAL", "Limit": 250}
    size = count = 0
    while True:
        started = time.monotonic()
        result = ddb.scan(**arguments)
        for item in result.get("Items", []):
            name = item["Key"]["S"]
            if not BLOB.fullmatch(name) or set(item) != {"Key", "Header", "Meta", "Value"}:
                raise RuntimeError("Unexpected source DynamoDB blob")
            content = b"".join(item[k]["B"] for k in ["Header", "Meta", "Value"])
            size += len(content)
            if size > PLAN["maximumSourceBytes"]:
                raise RuntimeError("Source exceeds reviewed size limit")
            (directory / name).write_bytes(content)
            count += 1
        emit("download-progress", objects=count, bytes=size)
        # Leave capacity for existing read-only demos while copying.
        elapsed = time.monotonic() - started
        time.sleep(max(0, result["ConsumedCapacity"]["CapacityUnits"] / 100 - elapsed))
        if "LastEvaluatedKey" not in result:
            break
        arguments["ExclusiveStartKey"] = result["LastEvaluatedKey"]
    if not count:
        raise RuntimeError("Empty source table")
    emit("source-copied", bytes=size, objects=count)


def migrate(profile, work, config):
    command = json.loads((work / "java-command.json").read_text())
    args = (["datomic", config["target"]] if profile == "datomic-dynamodb" else
            ["datahike", str(work / "store"), config["storeId"]])
    evidence = work / "migration.jsonl"
    with evidence.open("w") as out:
        process = subprocess.Popen(command + args, cwd=ROOT, stdout=subprocess.PIPE, text=True)
        for line in process.stdout:
            out.write(line)
            out.flush()
            print(line, end="", flush=True)
        if process.wait() != 0:
            raise RuntimeError("Native v8 migration failed")
    reports = []
    for line in evidence.read_text().splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if value.get("kind") == "migration-complete":
            reports.append(value)
    if len(reports) != 1 or reports[0].get("status") != "ready" or reports[0].get("storageVersion") != 8:
        raise RuntimeError("Native migration completion evidence is absent")
    return reports[0]


def blobs(directory):
    paths = sorted(directory.glob("*.ksv"))
    size = sum(p.stat().st_size for p in paths)
    if not paths or size > PLAN["maximumTargetBytes"]:
        raise RuntimeError("Migrated store absent or over reviewed size limit")
    return paths, size


def upload_s3(profile, config, directory):
    s3 = client("s3")
    target = config["target"]
    try:
        s3.head_bucket(Bucket=target)
        current = {x["Key"]: x["Value"] for x in s3.get_bucket_tagging(Bucket=target)["TagSet"]}
        if current.get("PublicationPhase") != "migrating":
            raise RuntimeError("Refusing to rewrite a published target bucket")
    except ClientError as error:
        if error.response["Error"]["Code"] not in {"404", "NoSuchBucket"}:
            raise
        s3.create_bucket(Bucket=target)
        s3.put_bucket_tagging(Bucket=target, Tagging={"TagSet": tags(profile)})
    s3.put_public_access_block(Bucket=target, PublicAccessBlockConfiguration={
        "BlockPublicAcls": True, "IgnorePublicAcls": True,
        "BlockPublicPolicy": True, "RestrictPublicBuckets": True})
    s3.put_bucket_encryption(Bucket=target, ServerSideEncryptionConfiguration={"Rules": [
        {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]})
    s3.put_bucket_versioning(Bucket=target, VersioningConfiguration={"Status": "Enabled"})
    paths, size = blobs(directory)
    prefix = config["storeId"] + "_"

    def upload(path):
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        s3.put_object(Bucket=target, Key=prefix + path.name, Body=content,
                      ServerSideEncryption="AES256", Metadata={"sha256": digest})

    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        for index, _ in enumerate(pool.map(upload, paths), 1):
            if index % 10000 == 0:
                emit("upload-progress", objects=index)
    s3.put_object(Bucket=target, Key=prefix + ".konserve-metadata", Body=b"konserve",
                  ServerSideEncryption="AES256")
    emit("target-uploaded", objects=len(paths), bytes=size)


def blob_item(path):
    content = path.read_bytes()
    if len(content) < 20 or content[0] != 1:
        raise RuntimeError("Unsupported Konserve blob header")
    meta_size = int.from_bytes(content[4:8], "big", signed=True)
    split = 20 + meta_size
    if meta_size < 0 or split > len(content) or len(content) + len(path.name) + 18 > 380 * 1024:
        raise RuntimeError("Invalid or oversized DynamoDB blob")
    return {"Key": {"S": path.name}, "Header": {"B": content[:20]},
            "Meta": {"B": content[20:split]}, "Value": {"B": content[split:]}}


def upload_ddb(profile, config, directory):
    ddb = client("dynamodb")
    target = config["target"]
    create_datahike_table(ddb, profile, target)
    paths, size = blobs(directory)
    # Preflight every item before uploading any data.
    for path in paths:
        blob_item(path)
    for offset in range(0, len(paths), 25):
        group = paths[offset:offset + 25]
        pending = {target: [{"PutRequest": {"Item": blob_item(p)}} for p in group]}
        started = time.monotonic()
        for attempt in range(12):
            result = ddb.batch_write_item(RequestItems=pending)
            pending = result.get("UnprocessedItems", {})
            if not pending:
                break
            time.sleep(min(5, .1 * 2 ** attempt))
        if pending:
            raise RuntimeError("DynamoDB upload retry limit")
        units = sum(math.ceil((p.stat().st_size + len(p.name) + 18) / 1024) for p in group)
        time.sleep(max(0, units / PLAN["exportWriteUnitsPerSecond"] - (time.monotonic() - started)))
        if offset % 1000 == 0:
            emit("upload-progress", objects=offset + len(group))
    emit("target-uploaded", objects=len(paths), bytes=size)


def restore_datomic(config):
    ddb = client("dynamodb")
    target = config["target"]
    install_table_alarms("datomic-dynamodb", target)
    table = table_or_none(ddb, target)
    if table is None:
        ddb.restore_table_to_point_in_time(SourceTableName=config["source"], TargetTableName=target,
                                           UseLatestRestorableTime=True,
                                           BillingModeOverride="PAY_PER_REQUEST",
                                           OnDemandThroughputOverride={
                                               "MaxReadRequestUnits": PLAN["migrationReadUnits"],
                                               "MaxWriteRequestUnits": PLAN["migrationWriteUnits"]})
        emit("restore-started", table=target)
        ddb.get_waiter("table_exists").wait(TableName=target, WaiterConfig={"Delay": 20, "MaxAttempts": 180})
        table = ddb.describe_table(TableName=target)["Table"]
        ddb.tag_resource(ResourceArn=table["TableArn"], Tags=tags("datomic-dynamodb"))
        ddb.update_table(TableName=target, DeletionProtectionEnabled=True)
        ddb.update_continuous_backups(TableName=target,
                                      PointInTimeRecoverySpecification={"PointInTimeRecoveryEnabled": True})
    else:
        assert_target_unpublished(ddb, table)
    emit("restore-ready", table=target, bytes=table.get("TableSizeBytes"))


def main():
    profile = sys.argv[1]
    if profile not in PLAN["profiles"] or os.environ.get("GITHUB_REF") != "refs/heads/production":
        raise RuntimeError("Migration requires the production CI ref and an exact profile")
    if client("sts").get_caller_identity()["Account"] != PLAN["account"]:
        raise RuntimeError("AWS account mismatch")
    cost_preflight()
    config = PLAN["profiles"][profile]
    work = ROOT / "target/storage-v8" / profile
    work.mkdir(parents=True, exist_ok=True)
    if profile == "datomic-dynamodb":
        restore_datomic(config)
        subprocess.run(["bash", "scripts/storage-v8-transactor.sh", str(work)], check=True)
        return
    directory = work / "store"
    directory.mkdir(exist_ok=False)
    if profile == "datahike-s3":
        download_s3(config["source"], config["storeId"], directory)
    else:
        download_ddb(config["source"], directory)
    report = migrate(profile, work, config)
    if profile == "datahike-s3":
        upload_s3(profile, config, directory)
    else:
        upload_ddb(profile, config, directory)
    (work / "complete.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
