import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
