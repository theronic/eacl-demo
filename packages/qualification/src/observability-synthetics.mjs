import { assertEnvelope, assertIdentity, successfulData } from "./runner.mjs";
import exemplars from "../../../fixtures/exemplars.v1.json" with { type: "json" };

const SYNTHETICS = Object.freeze(["health", "bootstrap", "exemplar"]);
const EXEMPLAR = Object.freeze(
  exemplars.cases.find(({ id, kind }) => id === "direct-owner-allow" && kind === "decision")
);
if (!EXEMPLAR) throw new Error("canonical observability exemplar is missing");

export async function runObservabilitySynthetics({
  transport,
  expectedIdentity,
  target,
  clock = () => new Date().toISOString()
}) {
  validateInput({ transport, expectedIdentity, target });
  const baseUrl = `${target.origin.replace(/\/$/u, "")}${normalizePath(target.path)}`;
  const checked = [];

  await check("health", async () => {
    const envelope = assertEnvelope(
      await transport.request("health", {}), "health"
    );
    const data = successfulData(envelope, "health");
    assertIdentity(data.identity, expectedIdentity);
    if (data.ready !== true || data.status !== "ready") {
      throw new Error("staged profile health is not ready");
    }
  });

  await check("bootstrap", async () => {
    const envelope = assertEnvelope(
      await transport.request("bootstrap", {}), "bootstrap"
    );
    const data = successfulData(envelope, "bootstrap");
    assertIdentity(data.identity, expectedIdentity);
  });

  await check("exemplar", async () => {
    const { demand, expected } = EXEMPLAR;
    const envelope = assertEnvelope(
      await transport.request("check-permission", {
        subjectType: demand.subject.type,
        subjectId: demand.subject.id,
        resourceType: demand.resource.type,
        resourceId: demand.resource.id,
        permission: demand.permission
      }),
      "check-permission"
    );
    const data = successfulData(envelope, "check-permission");
    if (data.allowed !== expected.allowed) {
      throw new Error("canonical authorization exemplar disagrees");
    }
  });

  return checked;

  async function check(name, run) {
    await run();
    const checkedAt = clock();
    if (!validTimestamp(checkedAt)) throw new TypeError(`synthetic ${name} timestamp is invalid`);
    checked.push({
      name,
      status: "passed",
      target: { kind: "staged-cloudfront", baseUrl },
      checkedAt,
      observedIdentity: structuredClone(expectedIdentity)
    });
  }
}

function validateInput({ transport, expectedIdentity, target }) {
  if (!transport || typeof transport.request !== "function") {
    throw new TypeError("observability synthetic transport is required");
  }
  assertIdentity(expectedIdentity, expectedIdentity);
  if (!target || target.kind !== "staged-cloudfront" ||
      target.profileId !== expectedIdentity.profileId) {
    throw new TypeError("observability synthetics require the exact staged CloudFront profile");
  }
  const origin = new URL(target.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) {
    throw new TypeError("observability synthetic origin must be clean HTTPS");
  }
  if (normalizePath(target.path) !== "/") {
    throw new TypeError("observability synthetic path does not match the profile");
  }
}

function normalizePath(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\/$/u, "") || "/";
}

function validTimestamp(value) {
  return typeof value === "string" && /Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

export const observabilitySyntheticNames = SYNTHETICS;
