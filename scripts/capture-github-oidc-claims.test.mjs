import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { customSubject, defaultEnvironmentSubject, loadManifest, workflowRef } from "./github-oidc-policy.mjs";
import { captureGitHubOidcClaims, validateAndCaptureToken } from "./capture-github-oidc-claims.mjs";

const manifest = await loadManifest();
const authority = manifest.authorities.find(({ id }) => id === "stateful-datomic-seed");
const now = new Date("2026-08-26T12:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "fixture-key";
jwk.use = "sig";
jwk.alg = "RS256";
const jwks = { keys: [jwk] };

const claims = (subject = customSubject(manifest, authority)) => ({
  iss: manifest.issuer,
  aud: manifest.audience,
  sub: subject,
  repository: manifest.repository.fullName,
  repository_id: manifest.repository.repositoryId,
  repository_owner: manifest.repository.owner,
  repository_owner_id: manifest.repository.ownerId,
  ref: manifest.repository.deploymentRef,
  ref_type: "branch",
  workflow: authority.workflowName,
  workflow_ref: workflowRef(manifest, authority),
  workflow_sha: "b".repeat(40),
  environment: authority.environment,
  event_name: authority.eventName,
  runner_environment: authority.runnerEnvironment,
  sha: "a".repeat(40),
  actor: "not-retained",
  actor_id: "999",
  run_id: "123",
  run_attempt: "1",
  jti: "not-retained",
  iat: nowSeconds - 30,
  nbf: nowSeconds - 30,
  exp: nowSeconds + 570
});

function token(payload, key = privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "fixture-key" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`, "ascii"), key).toString("base64url");
  return `${header}.${body}.${signature}`;
}

const capture = (payload, expectedSubjectMode = "transition") => validateAndCaptureToken({
  token: token(payload), jwks, manifest, authorityId: authority.id, expectedSubjectMode, now
});

test("capture retains only the closed non-secret claim allowlist", () => {
  const result = capture(claims());
  assert.deepEqual(Object.keys(result), ["schema", "authorityId", "signatureVerified", "expectedSubjectMode", "observedSubjectMode", "claims"]);
  assert.deepEqual(Object.keys(result.claims), [
    "iss", "aud", "sub", "repository", "repository_id", "repository_owner", "repository_owner_id", "ref", "ref_type",
    "workflow", "workflow_ref", "environment", "event_name", "runner_environment"
  ]);
  assert.equal(result.observedSubjectMode, "custom");
  for (const forbidden of ["actor", "actor_id", "sha", "run_id", "run_attempt", "jti", "iat", "nbf", "exp", "token", "signature"]) {
    assert.equal(JSON.stringify(result).includes(`\"${forbidden}\"`), false, `${forbidden} leaked into evidence`);
  }
});

test("transition capture accepts only the two exact migration subjects", () => {
  assert.equal(capture(claims(defaultEnvironmentSubject(manifest, authority))).observedSubjectMode, "default");
  assert.equal(capture(claims(), "custom").observedSubjectMode, "custom");
  assert.throws(() => capture(claims(defaultEnvironmentSubject(manifest, authority)), "custom"), /subject mode/u);
  assert.throws(() => capture(claims("repo:theronic/eacl-demo:environment:demo-stateful-datomic-seed")), /migration subject/u);
});

test("every trust-relevant claim is exact and a different called reusable workflow is rejected", () => {
  for (const [name, value] of Object.entries({
    iss: "https://example.invalid",
    aud: "https://github.com/theronic",
    repository: "theronic/eacl",
    repository_id: "999",
    repository_owner: "someone-else",
    repository_owner_id: "998",
    ref: "refs/heads/feature",
    ref_type: "tag",
    workflow: "Another workflow",
    workflow_ref: workflowRef(manifest, authority).replace("@refs/heads/production", "@refs/heads/feature"),
    environment: "demo-stateful-datomic-dynamodb",
    event_name: "push",
    runner_environment: "self-hosted"
  })) assert.throws(() => capture({ ...claims(), [name]: value }), new RegExp(`OIDC ${name} claim`, "u"));
  assert.doesNotThrow(() => capture({
    ...claims(),
    job_workflow_ref: workflowRef(manifest, authority),
    job_workflow_sha: "b".repeat(40)
  }));
  assert.throws(() => capture({
    ...claims(),
    job_workflow_ref: "theronic/eacl-demo/.github/workflows/reusable-deploy.yml@refs/heads/production"
  }), /different called reusable workflow/u);
  assert.throws(() => capture({
    ...claims(),
    job_workflow_ref: workflowRef(manifest, authority),
    job_workflow_sha: "c".repeat(40)
  }), /different called reusable workflow revision/u);
  assert.throws(() => capture({
    ...claims(),
    job_workflow_sha: "b".repeat(40)
  }), /different called reusable workflow revision/u);
});

test("signature, key, format, time, and lifetime failures expose no token material", () => {
  const foreign = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const raw = token(claims(), foreign);
  assert.throws(
    () => validateAndCaptureToken({ token: raw, jwks, manifest, authorityId: authority.id, expectedSubjectMode: "transition", now }),
    (error) => {
      assert.match(error.message, /signature/u);
      assert.equal(error.message.includes(raw), false);
      assert.equal(error.message.includes(raw.split(".")[1]), false);
      return true;
    }
  );
  assert.throws(() => capture({ ...claims(), exp: nowSeconds }), /expired/u);
  assert.throws(() => capture({ ...claims(), iat: nowSeconds - 3600 }), /lifetime/u);
  assert.throws(() => validateAndCaptureToken({ token: "not-a-jwt", jwks, manifest, authorityId: authority.id, expectedSubjectMode: "transition", now }), /format/u);
});

test("network capture sends the audience only to a trusted GitHub endpoint and never persists either credential", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eacl-oidc-"));
  const output = path.join(directory, "claims.json");
  const rawToken = token(claims());
  const requestSecret = "request-secret-that-must-not-be-retained";
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(JSON.stringify({ value: rawToken }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await captureGitHubOidcClaims({
      manifest,
      authorityId: authority.id,
      expectedSubjectMode: "transition",
      output,
      requestUrl: "https://pipelines.actions.githubusercontent.com/example/token?api-version=2.0",
      requestToken: requestSecret,
      fetchImpl,
      now
    });
    assert.equal(result.signatureVerified, true);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0].url).searchParams.get("audience"), manifest.audience);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${requestSecret}`);
    assert.equal(calls[1].url, `${manifest.issuer}/.well-known/jwks`);
    const stored = await readFile(output, "utf8");
    assert.equal(stored.includes(rawToken), false);
    assert.equal(stored.includes(requestSecret), false);
    assert.deepEqual(JSON.parse(stored), result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("untrusted request endpoints and failed fetches do not disclose endpoint or bearer material", async () => {
  await assert.rejects(
    captureGitHubOidcClaims({
      manifest,
      authorityId: authority.id,
      expectedSubjectMode: "transition",
      output: "/tmp/unused-oidc-claims.json",
      requestUrl: "https://evil.example/token?secret=url-secret",
      requestToken: "bearer-secret",
      fetchImpl: async () => { throw new Error("url-secret bearer-secret"); },
      now
    }),
    (error) => !/url-secret|bearer-secret|evil\.example/u.test(error.message) && /not trusted/u.test(error.message)
  );
  await assert.rejects(
    captureGitHubOidcClaims({
      manifest,
      authorityId: authority.id,
      expectedSubjectMode: "transition",
      output: "/tmp/unused-oidc-claims.json",
      requestUrl: "https://pipelines.actions.githubusercontent.com/token",
      requestToken: "bearer-secret",
      fetchImpl: async () => { throw new Error("bearer-secret"); },
      now
    }),
    (error) => !error.message.includes("bearer-secret") && /token request failed/u.test(error.message)
  );
});
