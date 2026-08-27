import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createObservabilityReadiness } from "./src/observability-readiness.mjs";

const identity = {
  profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40),
  artifactSha256: "c".repeat(64), deploymentId: "deploy-1",
  dataManifestSha256: "d".repeat(64)
};
const schema = JSON.parse(await readFile(new URL("../../schemas/observability-readiness.v1.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function input() {
  return {
    schema: "eacl-demo.observability-readiness.v1",
    identity,
    route: "/",
    completedAt: "2026-08-25T12:02:00Z",
    logs: { structured: true, redactionAudit: "passed", retentionDays: 14 },
    signals: ["requests", "errors", "duration", "initialization", "restore", "throttles", "timeouts", "oom", "storage"]
      .map((name) => ({ name, status: "ready" })),
    alarms: ["duration", "errors", "health", "initialization", "oom", "throttles", "timeouts"].map((name) => ({
      name, status: "ready", state: "OK", actionsEnabled: true,
      notificationPath: "sns-telegram",
      scope: { profileId: identity.profileId, resourceIdentifier: "eacl-demo-datahike-s3" }
    })),
    dashboard: { status: "ready", identifier: "eacl-demo-datahike-s3" },
    synthetics: ["bootstrap", "exemplar", "health"].map((name) => ({
      name, status: "passed",
      target: { kind: "staged-cloudfront", baseUrl: "https://staging.demo.eacl.dev/" },
      checkedAt: "2026-08-25T12:01:30Z", observedIdentity: identity
    })),
    runbook: { status: "ready", identifier: "docs/operator-runbook.md#profile-incidents" }
  };
}

test("runtime readiness evidence conforms to the closed JSON schema", () => {
  const evidence = createObservabilityReadiness(input());
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
});

test("schema and runtime both reject missing exemplar checks and duplicate signals", () => {
  const missingExemplar = input();
  missingExemplar.synthetics = missingExemplar.synthetics.filter(({ name }) => name !== "exemplar");
  assert.throws(() => createObservabilityReadiness(missingExemplar), /exact required set/u);

  const duplicateSignal = input();
  duplicateSignal.signals[8] = { name: "requests", status: "ready" };
  assert.throws(() => createObservabilityReadiness(duplicateSignal), /exact required set/u);
  duplicateSignal.evidenceId = `sha256:${"0".repeat(64)}`;
  assert.equal(validate(duplicateSignal), false);
});
