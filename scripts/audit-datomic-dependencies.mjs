import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(await readFile(path.join(root, "dependencies/datomic-dynamodb.v1.json"), "utf8"));
const coreLock = JSON.parse(await readFile(path.join(root, "dependencies/eacl-core.lock.json"), "utf8"));
const deps = await readFile(path.join(root, "deps.edn"), "utf8");
const credentialFreeEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^(?:AWS|DATOMIC)(?:_|$)/u.test(name))
);
const classpath = execFileSync("clojure", [
  "-A:datomic-dynamodb:datomic-http-server", "-Spath"
], {
  cwd: root,
  env: credentialFreeEnvironment,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
}).trim().split(path.delimiter);

assert.equal(lock.eacl.commit, coreLock.sha);
assert.ok(compareVersions(lock.datomic.version, lock.datomic.minimumReadOnlyVersion) >= 0);
assert.equal(lock.datomic.distributionUrl,
  `https://datomic-pro-downloads.s3.amazonaws.com/${lock.datomic.version}/datomic-pro-${lock.datomic.version}.zip`);
assert.match(lock.datomic.distributionSha256, /^[0-9a-f]{64}$/u);
assert.ok(Number.isSafeInteger(lock.datomic.distributionBytes) && lock.datomic.distributionBytes > 0);
assert.equal(lock.datomic.distributionRoot, `datomic-pro-${lock.datomic.version}`);
assert.deepEqual(lock.datomic.supportedJavaLts, [17, 21, 25]);
assert.match(deps, new RegExp(`com\\.datomic/peer \\{:mvn/version "${escapeRegExp(lock.datomic.version)}"\\}`, "u"));
for (const module of lock.dynamodbSdk.modules) {
  const coordinate = escapeRegExp(module.coordinate);
  assert.match(deps, new RegExp(`${coordinate}(?:\\s| \\{)[\\s\\S]*?:mvn/version "${escapeRegExp(lock.dynamodbSdk.version)}"`, "u"));
}
assert.match(deps, new RegExp(`${lock.eacl.commit}[\\s\\S]*?modules/eacl-datomic`, "u"));

const expected = [
  [new RegExp(`/com/datomic/peer/${escapeRegExp(lock.datomic.version)}/peer-${escapeRegExp(lock.datomic.version)}\\.jar$`, "u"), lock.datomic.jarSha256],
  ...lock.dynamodbSdk.modules.map((module) => {
    const artifact = module.coordinate.split("/")[1];
    return [new RegExp(`/software/amazon/awssdk/${artifact}/${escapeRegExp(lock.dynamodbSdk.version)}/${artifact}-${escapeRegExp(lock.dynamodbSdk.version)}\\.jar$`, "u"), module.jarSha256];
  })
];
for (const [pattern, digest] of expected) {
  const artifactPath = classpath.find((entry) => pattern.test(entry));
  assert.ok(artifactPath, `missing classpath artifact: ${pattern}`);
  assert.equal(sha256(await readFile(artifactPath)), digest, `artifact digest mismatch: ${artifactPath}`);
}

const awsVersions = new Set(classpath.flatMap((entry) => {
  const match = /\/software\/amazon\/awssdk\/[^/]+\/([^/]+)\/[^/]+\.jar$/u.exec(entry);
  return match ? [match[1]] : [];
}));
assert.deepEqual([...awsVersions].sort(), lock.resolution.awsSdkV2Versions);
for (const coordinate of lock.resolution.excludedHttpClients) {
  const artifact = coordinate.split("/")[1];
  assert.equal(classpath.some((entry) => entry.includes(`/software/amazon/awssdk/${artifact}/`)), false, `${artifact} leaked onto serving classpath`);
}
for (const coordinate of lock.resolution.selectedHttpClients) {
  const artifact = coordinate.split("/")[1];
  assert.equal(classpath.some((entry) => entry.includes(`/software/amazon/awssdk/${artifact}/`)), true, `${artifact} is absent from serving classpath`);
}
assert.ok(classpath.some((entry) => entry.endsWith(`/modules/eacl-datomic/src`)), "pinned EACL Datomic adapter is absent");
const httpKitPath = classpath.find((entry) => /\/http-kit\/http-kit\/2\.8\.1\/http-kit-2\.8\.1\.jar$/u.test(entry));
assert.ok(httpKitPath, "pinned http-kit server is absent");
assert.equal(sha256(await readFile(httpKitPath)), lock.httpServer.jarSha256,
  "http-kit artifact digest mismatch");

const peerPomPath = classpath.find((entry) => /\/peer-[^/]+\.jar$/u.test(entry)).replace(/\.jar$/u, ".pom");
const peerPom = await readFile(peerPomPath, "utf8");
assert.match(peerPom, /<name>The Apache Software License, Version 2\.0<\/name>/u);
const dynamodbPomPath = classpath.find((entry) => /\/dynamodb-[^/]+\.jar$/u.test(entry)).replace(/\.jar$/u, ".pom");
const dynamodbPom = await readFile(dynamodbPomPath, "utf8");
assert.match(dynamodbPom, /Licensed under the Apache License, Version 2\.0/u);
const httpKitPom = await readFile(httpKitPath.replace(/\.jar$/u, ".pom"), "utf8");
assert.match(httpKitPom, /<license>[\s\S]*?<name>Apache License, Version 2\.0<\/name>/u);

console.log("Datomic/DynamoDB dependency provenance and convergence audit passed");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
