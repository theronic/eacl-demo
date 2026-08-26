import importlib.util
import json
import os
import pathlib
import sys
import types
import unittest
import urllib.parse
from unittest import mock


class _Secrets:
    def __init__(self, token):
        self.token = token

    def get_secret_value(self, **kwargs):
        if kwargs != {"SecretId": "secret-arn"}:
            raise AssertionError(kwargs)
        return {"SecretString": self.token}


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return b'{"ok": true}'


def _load_module(token="bot-token-value"):
    fake_boto3 = types.SimpleNamespace(client=lambda service: _Secrets(token))
    with mock.patch.dict(sys.modules, {"boto3": fake_boto3}):
        path = pathlib.Path(__file__).with_name("index.py")
        spec = importlib.util.spec_from_file_location("eacl_demo_notifier", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


class NotifierTest(unittest.TestCase):
    def setUp(self):
        self.module = _load_module()
        self.environment = {
            "TELEGRAM_SECRET_ARN": "secret-arn",
            "TELEGRAM_CHAT_ID": "-12345",
            "PROJECT_LABEL": "EACL demo",
            "DEMO_URL": "https://demo.eacl.dev/",
        }

    def test_renders_alarm_budget_anomaly_deployment_and_generic_messages(self):
        alarm = self.module.render_message(
            json.dumps({"AlarmName": "read-cap", "NewStateValue": "ALARM"}),
            "EACL demo",
        )
        budget = self.module.render_message(
            json.dumps({"BudgetName": "monthly", "NotificationType": "ACTUAL"}),
            "EACL demo",
        )
        anomaly = self.module.render_message(
            json.dumps({"AnomalyId": "a", "Service": "DynamoDB", "TotalImpact": 3}),
            "EACL demo",
        )
        deployment = self.module.render_message(
            json.dumps(
                {
                    "detail-type": "CloudFormation Stack Status Change",
                    "time": "2026-08-25T12:00:00Z",
                    "region": "us-east-1",
                    "detail": {
                        "stack-id": "arn:aws:cloudformation:us-east-1:843761893873:stack/eacl-demo-static/id",
                        "status-details": {"status": "UPDATE_FAILED", "status-reason": "sensitive upstream detail"},
                    },
                }
            ),
            "EACL demo",
        )
        generic = self.module.render_message("deployment failed", "EACL demo")
        recovery = self.module.render_message(
            json.dumps(
                {
                    "source": "aws.cloudwatch",
                    "detail-type": "CloudWatch Alarm State Change",
                    "time": "2026-08-25T12:00:00Z",
                    "region": "us-east-1",
                    "detail": {
                        "alarmName": "eacl-demo-table-read-cap-70",
                        "state": {"value": "OK", "reason": "Threshold no longer breached"},
                        "previousState": {"value": "ALARM"},
                        "configuration": {"metrics": "must not be rendered"},
                    },
                }
            ),
            "EACL demo",
            "https://demo.eacl.dev/",
        )
        self.assertIn("ALARM", alarm)
        self.assertIn("BUDGET", budget)
        self.assertIn("COST ANOMALY", anomaly)
        self.assertIn("DEPLOYMENT FAILED", deployment)
        self.assertIn("eacl-demo-static", deployment)
        self.assertNotIn("sensitive upstream detail", deployment)
        self.assertIn("NOTICE", generic)
        self.assertIn("RECOVERED", recovery)
        self.assertIn("eacl-demo-table-read-cap-70", recovery)
        self.assertNotIn("configuration", recovery)
        self.assertNotIn("must not be rendered", recovery)

    def test_non_alarm_to_ok_event_is_not_rendered_as_recovery(self):
        event = {
            "source": "aws.cloudwatch",
            "detail-type": "CloudWatch Alarm State Change",
            "detail": {
                "alarmName": "eacl-demo-new-alarm",
                "state": {"value": "OK"},
                "previousState": {"value": "INSUFFICIENT_DATA"},
            },
        }
        rendered = self.module.render_message(json.dumps(event), "EACL demo")
        self.assertIn("NOTICE", rendered)
        self.assertNotIn("RECOVERED", rendered)

    def test_handler_delivers_without_logging_or_raising_the_token(self):
        event = {
            "Records": [
                {"Sns": {"MessageId": "message-1", "Message": "synthetic alarm"}}
            ]
        }
        captured = {}

        def open_request(request, timeout):
            captured["url"] = request.full_url
            captured["body"] = urllib.parse.parse_qs(request.data.decode("utf-8"))
            self.assertEqual(10, timeout)
            return _Response()

        with mock.patch.dict(os.environ, self.environment, clear=True), mock.patch.object(
            self.module.urllib.request, "urlopen", side_effect=open_request
        ), mock.patch("builtins.print") as output:
            self.assertEqual({"delivered": 1}, self.module.handler(event, None))
            self.assertEqual(["-12345"], captured["body"]["chat_id"])
            self.assertNotIn("bot-token-value", str(output.call_args_list))

    def test_network_failure_is_redacted(self):
        event = {"Records": [{"Sns": {"Message": "synthetic"}}]}
        with mock.patch.dict(os.environ, self.environment, clear=True), mock.patch.object(
            self.module.urllib.request,
            "urlopen",
            side_effect=RuntimeError("bot-token-value leaked upstream"),
        ):
            with self.assertRaisesRegex(RuntimeError, "network-error") as raised:
                self.module.handler(event, None)
            self.assertNotIn("bot-token-value", str(raised.exception))

    def test_bounds_records_messages_chat_id_and_json_secret(self):
        with self.assertRaisesRegex(RuntimeError, "record count"):
            with mock.patch.dict(os.environ, self.environment, clear=True):
                self.module.handler({"Records": [{}] * 11}, None)
        invalid_environment = dict(self.environment, TELEGRAM_CHAT_ID="not-a-chat")
        with self.assertRaisesRegex(RuntimeError, "identifier"):
            with mock.patch.dict(os.environ, invalid_environment, clear=True):
                self.module.handler({"Records": []}, None)
        self.assertEqual(
            "json-token",
            _load_module('{"bot_token":"json-token"}')._token_from_secret(
                '{"bot_token":"json-token"}'
            ),
        )


if __name__ == "__main__":
    unittest.main()
