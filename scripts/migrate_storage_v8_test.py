import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("migration", Path(__file__).with_name("migrate-storage-v8.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTransferTests(unittest.TestCase):
    def test_dynamodb_blob_round_trip_preserves_all_bytes(self):
        header = bytes([1, 0, 0, 0]) + (4).to_bytes(4, "big") + bytes(12)
        content = header + b"meta" + b"value"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "00000000-0000-4000-8000-000000000001.ksv"
            path.write_bytes(content)
            item = migration.blob_item(path)
            self.assertEqual(content, b"".join(item[k]["B"] for k in ["Header", "Meta", "Value"]))
            self.assertEqual(path.name, item["Key"]["S"])

    def test_invalid_or_oversized_blob_is_refused_before_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "00000000-0000-4000-8000-000000000001.ksv"
            for content in [b"short", bytes([2]) + bytes(30), bytes([1, 0, 0, 0]) + (100).to_bytes(4, "big") + bytes(12), bytes([1]) + bytes(400 * 1024)]:
                path.write_bytes(content)
                with self.assertRaises(RuntimeError):
                    migration.blob_item(path)

    def test_published_generation_cannot_be_migrated_again(self):
        class Table:
            def list_tags_of_resource(self, **kwargs):
                return {"Tags": [{"Key": "Generation", "Value": "fixture-v8"},
                                 {"Key": "PublicationPhase", "Value": "serving"}]}
        with self.assertRaisesRegex(RuntimeError, "unpublished"):
            migration.assert_target_unpublished(Table(), {"TableArn": "exact-target"})

    def test_s3_copy_rejects_unexpected_paths(self):
        class Pages:
            def paginate(self, **kwargs):
                return [{"Contents": [{"Key": "id_../../outside", "Size": 1, "ETag": "etag"}]}]
        class S3:
            def get_paginator(self, name):
                return Pages()
        with tempfile.TemporaryDirectory() as directory, patch.object(migration, "client", return_value=S3()):
            with self.assertRaisesRegex(RuntimeError, "Unexpected"):
                migration.download_s3("source", "id", Path(directory))


class ReaderPublicationTests(unittest.TestCase):
    def test_missing_native_certificate_does_not_grant_access(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "verified-migration").mkdir()
            (work / "verified-migration/complete.json").write_text(json.dumps({"status": "ready"}))
            with patch.object(migration, "client") as clients:
                with self.assertRaisesRegex(RuntimeError, "certify"):
                    migration.publish_readers("datahike-dynamodb", migration.PLAN["profiles"]["datahike-dynamodb"], work)
                clients.assert_not_called()

    def test_publication_is_read_only_and_retryable_after_partial_iam_failure(self):
        profile = "datahike-dynamodb"
        config = migration.PLAN["profiles"][profile]
        roles = migration.PLAN["readerRoles"][profile]
        iam, lambdas, ddb = MagicMock(), MagicMock(), MagicMock()
        lambdas.get_function_configuration.side_effect = lambda **args: {
            "Role": "arn:aws:iam::843761893873:role/" + roles[0 if args["FunctionName"].endswith("-live") else 1]}
        table = {"TableArn": "arn:aws:dynamodb:us-east-1:843761893873:table/" + config["target"],
                 "DeletionProtectionEnabled": True,
                 "OnDemandThroughput": {"MaxReadRequestUnits": 250, "MaxWriteRequestUnits": 1000}}
        ddb.describe_table.return_value = {"Table": table}
        ddb.list_tags_of_resource.return_value = {"Tags": migration.tags(profile)}
        ddb.describe_continuous_backups.return_value = {"ContinuousBackupsDescription": {
            "PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "ENABLED"}}}
        with tempfile.TemporaryDirectory() as directory, patch.object(migration, "client", side_effect={
                "iam": iam, "lambda": lambdas, "dynamodb": ddb}.__getitem__):
            work = Path(directory)
            (work / "verified-migration").mkdir()
            (work / "verified-migration/complete.json").write_text(json.dumps({
                "status": "ready", "storageVersion": 8,
                "relationships": {"state": "complete", "source-count": 1, "source-digest": "fixture"},
                "application": {"sha256": "fixture"}}))
            iam.put_role_policy.side_effect = [None, RuntimeError("temporary IAM failure")]
            with self.assertRaisesRegex(RuntimeError, "temporary IAM"):
                migration.publish_readers(profile, config, work)
            ddb.tag_resource.assert_not_called()
            self.assertFalse((work / "complete.json").exists())
            iam.put_role_policy.side_effect = None
            migration.publish_readers(profile, config, work)
            self.assertEqual(set(roles), {call.kwargs["RoleName"] for call in iam.put_role_policy.call_args_list})
            for call in iam.put_role_policy.call_args_list:
                statements = json.loads(call.kwargs["PolicyDocument"])["Statement"]
                self.assertEqual([table["TableArn"]], [statement["Resource"] for statement in statements])
                self.assertEqual({"dynamodb:BatchGetItem", "dynamodb:DescribeTable", "dynamodb:GetItem",
                                  "dynamodb:Query", "dynamodb:Scan"}, set(statements[0]["Action"]))
            self.assertEqual(1, ddb.update_table.call_args.kwargs["OnDemandThroughput"]["MaxWriteRequestUnits"])
            self.assertIn({"Key": "PublicationPhase", "Value": "ready"}, ddb.tag_resource.call_args.kwargs["Tags"])
            self.assertEqual("ready", json.loads((work / "complete.json").read_text())["status"])


if __name__ == "__main__":
    unittest.main()
