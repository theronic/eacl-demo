import assert from "node:assert/strict";
import test from "node:test";
import { scanBytes } from "./lib/secret-scan.mjs";

test("detects representative credentials without storing them in source", () => {
  const samples = [
    ["aws-access-key", `AKIA${"A".repeat(16)}`],
    ["telegram-bot-token", `${"1".repeat(10)}:${"a".repeat(35)}`],
    ["github-token", `ghp_${"a".repeat(40)}`],
    ["private-key", `-----BEGIN ${"PRIVATE"} KEY-----`],
    ["basic-auth-url", `${["https", "://", "demo-user", ":"].join("")}${"p".repeat(20)}@example.test/path`],
    ["credential-query", `datomic:ddb://us-east-1/demo?secret_${"access_key"}=${"a".repeat(40)}`]
  ];
  for (const [rule, sample] of samples) assert.equal(scanBytes(Buffer.from(sample)).some((finding) => finding.rule === rule), true, rule);
});

test("Datahike basis IDs are not mistaken for standalone Telegram credentials", () => {
  assert.deepEqual(scanBytes(Buffer.from(`datahike:${"1".repeat(10)}:${"a".repeat(35)}`)), []);
});

test("does not classify immutable hashes, ARNs, or redacted metadata as credentials", () => {
  const safe = JSON.stringify({ sha256: "a".repeat(64), arn: "arn:aws:lambda:us-east-1:843761893873:function:demo", token: "REDACTED", valueCaptured: false });
  assert.deepEqual(scanBytes(Buffer.from(safe)), []);
});

test("findings reveal only rule, location, and a short fingerprint", () => {
  const secret = `${"1".repeat(10)}:${"z".repeat(35)}`;
  const [finding] = scanBytes(Buffer.from(secret), "bundle.js");
  assert.deepEqual(Object.keys(finding).sort(), ["file", "fingerprint", "offset", "rule"]);
  assert.equal(JSON.stringify(finding).includes(secret), false);
});
