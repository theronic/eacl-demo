"""General SNS-to-Telegram notifier with redacted failure behavior."""

import json
import os
import re
import urllib.parse
import urllib.request

import boto3


MAX_RECORDS = 10
MAX_SNS_MESSAGE_BYTES = 64 * 1024
MAX_TELEGRAM_TEXT = 3900
CHAT_ID = re.compile(r"^-?[0-9]+$")


def _bounded(value, limit=MAX_TELEGRAM_TEXT):
    text = str(value).replace("\x00", "")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _json_object(raw_message):
    try:
        value = json.loads(raw_message)
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _alarm_message(message, project, demo_url):
    state = message.get("NewStateValue", "UNKNOWN")
    marker = "RECOVERED" if state == "OK" else state
    lines = [
        f"{project} {marker}",
        f"Alarm: {message.get('AlarmName', 'unknown')}",
        f"Reason: {message.get('NewStateReason', 'not supplied')}",
        f"Time: {message.get('StateChangeTime', 'unknown')}",
        f"Region: {message.get('Region', 'unknown')}",
    ]
    if demo_url:
        lines.append(f"Demo: {demo_url}")
    return "\n".join(lines)


def _alarm_recovery_message(message, project, demo_url):
    if (
        message.get("source") != "aws.cloudwatch"
        or message.get("detail-type") != "CloudWatch Alarm State Change"
    ):
        return None
    detail = message.get("detail")
    if not isinstance(detail, dict):
        return None
    state = detail.get("state")
    previous = detail.get("previousState")
    if (
        not isinstance(state, dict)
        or not isinstance(previous, dict)
        or state.get("value") != "OK"
        or previous.get("value") != "ALARM"
    ):
        return None
    lines = [
        f"{project} RECOVERED",
        f"Alarm: {_bounded(detail.get('alarmName', 'unknown'), 255)}",
        f"Reason: {_bounded(state.get('reason', 'not supplied'), 1000)}",
        f"Time: {_bounded(message.get('time', state.get('timestamp', 'unknown')), 64)}",
        f"Region: {_bounded(message.get('region', 'unknown'), 64)}",
    ]
    if demo_url:
        lines.append(f"Demo: {demo_url}")
    return "\n".join(lines)


def _anomaly_message(message, project):
    anomaly = message.get("anomalyDetails") or message.get("AnomalyDetails") or message
    impact = anomaly.get("totalImpact") or anomaly.get("TotalImpact") or "unknown"
    service = anomaly.get("service") or anomaly.get("Service") or "unknown"
    return "\n".join(
        [
            f"{project} COST ANOMALY",
            f"Service: {service}",
            f"Impact: {impact}",
            f"Start: {anomaly.get('startDate', anomaly.get('StartDate', 'unknown'))}",
        ]
    )


def _budget_message(raw_message, message, project):
    budget_name = message.get("budgetName") or message.get("BudgetName")
    if budget_name:
        return "\n".join(
            [
                f"{project} BUDGET",
                f"Budget: {budget_name}",
                f"Status: {message.get('notificationType', message.get('NotificationType', 'threshold crossed'))}",
                f"Amount: {message.get('costAmount', message.get('CostAmount', 'see AWS Billing'))}",
            ]
        )
    if "budget" in raw_message.lower():
        return f"{project} BUDGET\n{raw_message}"
    return None


def _deployment_message(message, project):
    if message.get("detail-type") != "CloudFormation Stack Status Change":
        return None
    detail = message.get("detail")
    if not isinstance(detail, dict):
        return None
    status_details = detail.get("status-details")
    if not isinstance(status_details, dict):
        return None
    stack_id = str(detail.get("stack-id", "unknown"))
    stack_name = stack_id.split(":stack/", 1)[-1].split("/", 1)[0]
    return "\n".join(
        [
            f"{project} DEPLOYMENT FAILED",
            f"Stack: {_bounded(stack_name, 128)}",
            f"Status: {_bounded(status_details.get('status', 'unknown'), 64)}",
            f"Time: {_bounded(message.get('time', 'unknown'), 64)}",
            f"Region: {_bounded(message.get('region', 'unknown'), 64)}",
        ]
    )


def render_message(raw_message, project, demo_url=""):
    raw_message = _bounded(raw_message, MAX_SNS_MESSAGE_BYTES)
    message = _json_object(raw_message)
    if message and "AlarmName" in message:
        rendered = _alarm_message(message, project, demo_url)
    elif message and (recovery := _alarm_recovery_message(message, project, demo_url)):
        rendered = recovery
    elif message and (
        "anomalyDetails" in message
        or "AnomalyDetails" in message
        or "AnomalyId" in message
    ):
        rendered = _anomaly_message(message, project)
    elif message and (deployment := _deployment_message(message, project)):
        rendered = deployment
    else:
        rendered = _budget_message(raw_message, message or {}, project)
        if rendered is None:
            rendered = f"{project} NOTICE\n{raw_message}"
    return _bounded(rendered)


def _token_from_secret(secret_string):
    value = secret_string.strip()
    if not value:
        raise RuntimeError("Telegram bot token secret is empty")
    parsed = _json_object(value)
    if parsed is not None:
        value = str(parsed.get("bot_token") or parsed.get("token") or "").strip()
    if not value:
        raise RuntimeError("Telegram bot token secret has no supported token field")
    return value


def handler(event, context):
    del context
    secret_arn = os.environ["TELEGRAM_SECRET_ARN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    project = _bounded(os.environ.get("PROJECT_LABEL", "EACL demo"), 80)
    demo_url = _bounded(os.environ.get("DEMO_URL", ""), 512)
    if not CHAT_ID.fullmatch(chat_id):
        raise RuntimeError("Telegram chat identifier is invalid")

    records = event.get("Records", []) if isinstance(event, dict) else []
    if not isinstance(records, list) or len(records) > MAX_RECORDS:
        raise RuntimeError("SNS record count is invalid")

    token = _token_from_secret(
        boto3.client("secretsmanager")
        .get_secret_value(SecretId=secret_arn)["SecretString"]
    )
    delivered = 0
    try:
        for record in records:
            sns = record.get("Sns", {}) if isinstance(record, dict) else {}
            raw_message = sns.get("Message", "")
            if len(str(raw_message).encode("utf-8")) > MAX_SNS_MESSAGE_BYTES:
                raise RuntimeError("SNS message exceeds notifier limit")
            body = urllib.parse.urlencode(
                {
                    "chat_id": chat_id,
                    "text": render_message(raw_message, project, demo_url),
                    "disable_web_page_preview": "true",
                }
            ).encode("utf-8")
            request = urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    accepted = json.loads(response.read().decode("utf-8"))
            except Exception as error:
                status = getattr(error, "code", "network-error")
                raise RuntimeError(
                    f"Telegram delivery failed with status {status}"
                ) from None
            if not accepted.get("ok"):
                raise RuntimeError("Telegram rejected the notification")
            delivered += 1
            print(
                "delivered telegram notification "
                f"sns_message_id={sns.get('MessageId', 'unknown')}"
            )
    finally:
        token = None
    return {"delivered": delivered}
