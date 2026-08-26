"""Disposable IAM data-plane probe. Responses contain only bounded classifications."""

import os

import boto3
from botocore.exceptions import ClientError


def _result(allowed, operation, error=None):
    code = None
    if error is not None:
        code = error.response.get("Error", {}).get("Code", "Unknown")[:80]
    return {"allowed": allowed, "operation": operation, "errorCode": code}


def handler(event, context):
    del context
    event = event if isinstance(event, dict) else {}
    operation = event.get("operation", "get")
    table = event.get("table", os.environ["TABLE_NAME"])
    if not isinstance(table, str) or len(table) > 255:
        raise ValueError("invalid table")
    client = boto3.client("dynamodb")
    try:
        if operation == "get":
            client.get_item(
                TableName=table,
                Key={"Key": {"S": "published"}},
                ConsistentRead=True,
            )
        elif operation == "put":
            client.put_item(
                TableName=table,
                Item={"Key": {"S": "iam-probe-must-not-write"}},
            )
        else:
            raise ValueError("invalid operation")
        return _result(True, operation)
    except ClientError as error:
        return _result(False, operation, error)
