import assert from "node:assert/strict";
import test from "node:test";

import {
  executionForPlatform,
  normalizePlatform,
  platformOptions,
  profileForPlatform
} from "./src/platforms.mjs";

test("Datomic and Datalevin share EC2 while Datahike exposes only Lambda sizes", () => {
  const datomic = { backend: "datomic", storage: "dynamodb" };
  assert.deepEqual(platformOptions(datomic).map(({ id, selectable }) => [id, selectable]), [
    ["lambda-1769", true], ["lambda-4096", true], ["ec2", true]
  ]);
  assert.deepEqual(platformOptions({ backend: "datahike", storage: "dynamodb" })
    .map(({ id, selectable }) => [id, selectable]), [
    ["lambda-1769", true], ["lambda-4096", true], ["ec2", false]
  ]);
  assert.equal(normalizePlatform({ backend: "datahike", storage: "s3" }, "ec2"), "lambda-1769");
  assert.deepEqual(platformOptions({ backend: "datalevin", storage: "embedded" })
    .map(({ id, selectable }) => [id, selectable]), [
    ["lambda-1769", true], ["lambda-4096", false], ["ec2", true]
  ]);
  assert.equal(normalizePlatform(datomic, "lambda-1024"), "lambda-1769");
});

test("each Datahike storage maps its 4 GiB option to a distinct deployed origin", () => {
  const base = { backend: "datahike", apiOrigin: "https://small.example" };
  const s3 = profileForPlatform({ ...base, id: "datahike-s3", storage: "s3" }, "lambda-4096");
  const dynamodb = profileForPlatform({ ...base, id: "datahike-dynamodb", storage: "dynamodb" }, "lambda-4096");
  assert.match(s3.apiOrigin, /lambda-url/u);
  assert.match(dynamodb.apiOrigin, /lambda-url/u);
  assert.notEqual(s3.apiOrigin, dynamodb.apiOrigin);
});

test("platform selection changes only the deployment origin and execution label", () => {
  const profile = { backend: "datomic", storage: "dynamodb", apiOrigin: "https://small.example" };
  assert.equal(profileForPlatform(profile, "lambda-1769").apiOrigin, profile.apiOrigin);
  assert.match(profileForPlatform(profile, "lambda-4096").apiOrigin, /lambda-url/u);
  assert.equal(profileForPlatform(profile, "ec2").apiOrigin, "https://datomic.demo.eacl.dev");
  assert.equal(profileForPlatform({ backend: "datalevin", storage: "embedded", apiOrigin: "https://small.example" }, "ec2").apiOrigin,
    "https://datalevin.demo.eacl.dev");
  assert.equal(executionForPlatform("lambda-4096"), "lambda");
  assert.equal(executionForPlatform("ec2"), "ec2");
});
