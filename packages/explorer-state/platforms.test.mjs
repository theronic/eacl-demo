import assert from "node:assert/strict";
import test from "node:test";

import {
  executionForPlatform,
  normalizePlatform,
  platformOptions,
  profileForPlatform
} from "./src/platforms.mjs";

test("the EC2 option names the host behind the selected backend", () => {
  const ec2 = (selection) => platformOptions(selection).find(({ id }) => id === "ec2");
  assert.equal(ec2({ backend: "datomic", storage: "dynamodb" }).label, "EC2 t3.small (2 GiB)");
  assert.equal(ec2({ backend: "datalevin", storage: "embedded" }).label, "EC2 t3.micro (1 GiB)");
  // Datahike has no EC2 host, so its unavailable option claims no instance.
  for (const storage of ["s3", "dynamodb"]) {
    const option = ec2({ backend: "datahike", storage });
    assert.equal(option.label, "EC2");
    assert.equal(option.selectable, false);
    assert.equal(option.reason, "EC2 is currently deployed only for Datomic/DynamoDB and Datalevin/Embedded disk.");
  }
  // The Lambda sizes are one deployment shape for every backend.
  for (const selection of [
    { backend: "datomic", storage: "dynamodb" },
    { backend: "datalevin", storage: "embedded" },
    { backend: "datahike", storage: "s3" }
  ]) {
    assert.deepEqual(platformOptions(selection).slice(0, 2).map(({ label }) => label),
      ["1,769 MiB Lambda (1 vCPU)", "4 GiB Lambda"]);
  }
});

test("Datomic and Datalevin both offer EC2 while Datahike exposes only Lambda sizes", () => {
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
