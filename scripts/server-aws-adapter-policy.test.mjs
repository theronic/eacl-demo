import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./lib/server-aws-adapter.mjs", import.meta.url), "utf8");

test("dependency-free server adapter has a closed non-stateful AWS command surface", () => {
  assert.ok(source.includes('"--output", "json"'));
  assert.ok(source.includes('"--cli-auto-prompt", "off"'));
  for (const command of [
    '"sts", "get-caller-identity"',
    '"s3api", "get-bucket-versioning"', '"s3api", "get-public-access-block"', '"s3api", "get-bucket-ownership-controls"',
    '"s3api", "get-bucket-encryption"', '"s3api", "get-bucket-tagging"', '"s3api", "head-object"', '"s3api", "get-object"', '"s3api", "put-object"',
    '"lambda", "get-function-configuration"', '"lambda", "get-alias"', '"lambda", "get-function-url-config"', '"lambda", "list-tags"',
    '"lambda", "update-function-code"', '"lambda", "update-function-configuration"', '"lambda", "publish-version"', '"lambda", "update-alias"',
    '"cloudfront", "get-distribution"'
  ]) assert.ok(source.includes(command), `missing expected command ${command}`);
  assert.doesNotMatch(source, /["'](?:dynamodb|ec2|kms|iam|rds|route53|cloudformation)["']\s*,/u);
  assert.doesNotMatch(source, /["'](?:delete-object|delete-function|create-function|create-table|run-instances|terminate-instances|create-invalidation|add-permission)["']/u);
  assert.match(source, /"--if-match", ifMatch/u);
  assert.match(source, /"--revision-id", currentAlias\.revisionId/u);
  assert.match(source, /"--no-publish", "--revision-id", beforeCode\.RevisionId/u);
  assert.match(source, /"--server-side-encryption", "AES256"/u);
  assert.doesNotMatch(source, /aws-sdk|@aws-sdk|node_modules/u);
});

test("ambiguous public mutations are reconciled before the adapter returns or rolls back", () => {
  assert.match(source, /Reconcile a successful remote update with a lost or malformed response/u);
  assert.match(source, /restoreProfileStatusIfCurrent/u);
  assert.match(source, /observed\.publicationId !== attempt\.publicationId/u);
  assert.match(source, /a newer .* alias revision prevents ambiguous-update recovery/u);
});
