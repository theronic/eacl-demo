import assert from "node:assert/strict";
import test from "node:test";

import {
  executionForPlatform,
  normalizePlatform,
  platformOptions,
  profileForPlatform
} from "./src/platforms.mjs";

test("only Datomic/DynamoDB exposes the larger Lambda and EC2", () => {
  const datomic = { backend: "datomic", storage: "dynamodb" };
  assert.deepEqual(platformOptions(datomic).map(({ id, selectable }) => [id, selectable]), [
    ["lambda-1024", true], ["lambda-4096", true], ["ec2", true]
  ]);
  assert.deepEqual(platformOptions({ backend: "datahike", storage: "dynamodb" })
    .map(({ id, selectable }) => [id, selectable]), [
    ["lambda-1024", true], ["lambda-4096", false], ["ec2", false]
  ]);
  assert.equal(normalizePlatform({ backend: "datahike", storage: "s3" }, "ec2"), "lambda-1024");
});

test("platform selection changes only the deployment origin and execution label", () => {
  const profile = { backend: "datomic", storage: "dynamodb", apiOrigin: "https://small.example" };
  assert.equal(profileForPlatform(profile, "lambda-1024").apiOrigin, profile.apiOrigin);
  assert.match(profileForPlatform(profile, "lambda-4096").apiOrigin, /lambda-url/u);
  assert.equal(profileForPlatform(profile, "ec2").apiOrigin, "https://datomic.demo.eacl.dev");
  assert.equal(executionForPlatform("lambda-4096"), "lambda");
  assert.equal(executionForPlatform("ec2"), "ec2");
});
