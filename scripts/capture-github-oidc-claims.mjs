import { createPublicKey, verify } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  customSubject,
  defaultEnvironmentSubject,
  loadManifest,
  workflowRef
} from "./github-oidc-policy.mjs";

const TOKEN_HOST_SUFFIX = ".actions.githubusercontent.com";
const JWT_MAXIMUM_BYTES = 32 * 1024;
const JSON_MAXIMUM_BYTES = 256 * 1024;
const SUBJECT_MODES = new Set(["custom", "default", "transition"]);
const OUTPUT_CLAIMS = [
  "iss",
  "aud",
  "sub",
  "repository",
  "repository_id",
  "repository_owner",
  "repository_owner_id",
  "ref",
  "ref_type",
  "workflow",
  "workflow_ref",
  "environment",
  "event_name",
  "runner_environment"
];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function validateAndCaptureToken({ token, jwks, manifest, authorityId, expectedSubjectMode, now = new Date() }) {
  assert(typeof token === "string" && token.length > 0 && Buffer.byteLength(token) <= JWT_MAXIMUM_BYTES, "OIDC token is missing or oversized");
  assert(SUBJECT_MODES.has(expectedSubjectMode), "OIDC subject mode is invalid");
  assert(now instanceof Date && Number.isFinite(now.getTime()), "OIDC validation clock is invalid");
  const authority = manifest.authorities.find(({ id }) => id === authorityId);
  assert(authority, "OIDC authority is not registered");

  const segments = token.split(".");
  assert(segments.length === 3, "OIDC token format is invalid");
  const header = parseSegment(segments[0], "header");
  const claims = parseSegment(segments[1], "claims");
  assert(header?.alg === "RS256" && header.typ === "JWT" && typeof header.kid === "string" && /^[A-Za-z0-9._-]{1,256}$/u.test(header.kid), "OIDC token header is invalid");
  assert(jwks && Array.isArray(jwks.keys), "GitHub OIDC key set is invalid");
  const keys = jwks.keys.filter(({ kid }) => kid === header.kid);
  assert(keys.length === 1, "GitHub OIDC signing key is unavailable or ambiguous");
  const jwk = keys[0];
  assert(jwk?.kty === "RSA" && (!jwk.use || jwk.use === "sig") && (!jwk.alg || jwk.alg === "RS256"), "GitHub OIDC signing key is invalid");
  let key;
  try {
    key = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw new Error("GitHub OIDC signing key cannot be imported");
  }
  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${segments[0]}.${segments[1]}`, "ascii"),
    key,
    decodeBase64Url(segments[2], "signature")
  );
  assert(validSignature, "OIDC token signature is invalid");

  const nowSeconds = Math.floor(now.getTime() / 1000);
  for (const claim of ["iat", "nbf", "exp"]) assert(Number.isSafeInteger(claims[claim]), `OIDC ${claim} claim is invalid`);
  assert(claims.iat <= nowSeconds + 60, "OIDC token was issued in the future");
  assert(claims.nbf <= nowSeconds + 60, "OIDC token is not active");
  assert(claims.exp > nowSeconds, "OIDC token is expired");
  assert(claims.exp > claims.iat && claims.exp - claims.iat <= 20 * 60, "OIDC token lifetime is invalid");

  const expected = {
    iss: manifest.issuer,
    aud: manifest.audience,
    repository: manifest.repository.fullName,
    repository_id: manifest.repository.repositoryId,
    repository_owner: manifest.repository.owner,
    repository_owner_id: manifest.repository.ownerId,
    ref: manifest.repository.deploymentRef,
    ref_type: "branch",
    workflow: authority.workflowName,
    workflow_ref: workflowRef(manifest, authority),
    environment: authority.environment,
    event_name: authority.eventName,
    runner_environment: authority.runnerEnvironment
  };
  for (const [name, value] of Object.entries(expected)) assert(claims[name] === value, `OIDC ${name} claim does not match the registered authority`);
  assert(claims.job_workflow_ref === undefined && claims.job_workflow_sha === undefined, "OIDC token unexpectedly identifies a reusable workflow");

  const subjects = {
    custom: customSubject(manifest, authority),
    default: defaultEnvironmentSubject(manifest, authority)
  };
  const observedSubjectMode = Object.entries(subjects).find(([, subject]) => claims.sub === subject)?.[0];
  assert(observedSubjectMode, "OIDC subject does not match an exact registered migration subject");
  assert(expectedSubjectMode === "transition" || observedSubjectMode === expectedSubjectMode, "OIDC subject mode does not match the required migration phase");

  return Object.freeze({
    schema: "eacl-demo.github-oidc-claim-capture.v1",
    authorityId,
    signatureVerified: true,
    expectedSubjectMode,
    observedSubjectMode,
    claims: Object.freeze(Object.fromEntries(OUTPUT_CLAIMS.map((name) => [name, claims[name]])))
  });
}

export async function captureGitHubOidcClaims(options = {}) {
  const manifest = options.manifest ?? await loadManifest();
  const authorityId = options.authorityId ?? requiredEnvironment("EACL_OIDC_AUTHORITY_ID");
  const expectedSubjectMode = options.expectedSubjectMode ?? requiredEnvironment("EACL_OIDC_EXPECTED_SUBJECT_MODE");
  const output = options.output ?? requiredEnvironment("EACL_OIDC_CLAIMS_OUTPUT");
  const requestUrl = options.requestUrl ?? requiredEnvironment("ACTIONS_ID_TOKEN_REQUEST_URL");
  const requestToken = options.requestToken ?? requiredEnvironment("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const endpoint = tokenEndpoint(requestUrl, manifest.audience);
  const tokenResponse = await safeFetch(fetchImpl, endpoint, {
    headers: { Accept: "application/json", Authorization: `Bearer ${requestToken}` }
  }, "GitHub OIDC token request failed");
  const tokenBody = await boundedJson(tokenResponse, "GitHub OIDC token response");
  assert(typeof tokenBody.value === "string", "GitHub OIDC token response is invalid");

  const jwksResponse = await safeFetch(fetchImpl, `${manifest.issuer}/.well-known/jwks`, {
    headers: { Accept: "application/json" }
  }, "GitHub OIDC key request failed");
  const jwks = await boundedJson(jwksResponse, "GitHub OIDC key response");
  const result = validateAndCaptureToken({ token: tokenBody.value, jwks, manifest, authorityId, expectedSubjectMode, now });
  await writePrivateJson(output, result);
  return result;
}

function parseSegment(value, name) {
  const decoded = decodeBase64Url(value, name);
  assert(decoded.length > 0 && decoded.length <= JSON_MAXIMUM_BYTES, `OIDC token ${name} is oversized`);
  try {
    const parsed = JSON.parse(decoded.toString("utf8"));
    assert(parsed && typeof parsed === "object" && !Array.isArray(parsed), `OIDC token ${name} is invalid`);
    return parsed;
  } catch (error) {
    if (error?.message === `OIDC token ${name} is invalid`) throw error;
    throw new Error(`OIDC token ${name} is not JSON`);
  }
}

function decodeBase64Url(value, name) {
  assert(typeof value === "string" && /^[A-Za-z0-9_-]+$/u.test(value), `OIDC token ${name} encoding is invalid`);
  const decoded = Buffer.from(value, "base64url");
  assert(decoded.toString("base64url") === value, `OIDC token ${name} encoding is not canonical`);
  return decoded;
}

function tokenEndpoint(value, audience) {
  assert(typeof value === "string" && value.length <= 4096, "GitHub OIDC request endpoint is invalid");
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("GitHub OIDC request endpoint is invalid");
  }
  assert(endpoint.protocol === "https:" && (!endpoint.port || endpoint.port === "443") && !endpoint.username && !endpoint.password && !endpoint.hash && endpoint.hostname.endsWith(TOKEN_HOST_SUFFIX), "GitHub OIDC request endpoint is not trusted");
  endpoint.searchParams.set("audience", audience);
  return endpoint.href;
}

async function safeFetch(fetchImpl, url, options, message) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(message);
  }
  assert(response?.ok === true, message);
  return response;
}

async function boundedJson(response, name) {
  const type = response.headers?.get?.("content-type") ?? "";
  assert(/^application\/json(?:\s*;|$)/iu.test(type), `${name} content type is invalid`);
  const length = Number(response.headers?.get?.("content-length"));
  assert(!Number.isFinite(length) || (length >= 0 && length <= JSON_MAXIMUM_BYTES), `${name} is oversized`);
  let text = "";
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      assert(bytes <= JSON_MAXIMUM_BYTES, `${name} is oversized`);
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    text = await response.text();
    assert(Buffer.byteLength(text) <= JSON_MAXIMUM_BYTES, `${name} is oversized`);
  }
  try {
    const parsed = JSON.parse(text);
    assert(parsed && typeof parsed === "object" && !Array.isArray(parsed), `${name} is invalid`);
    return parsed;
  } catch (error) {
    if (error?.message === `${name} is invalid`) throw error;
    throw new Error(`${name} is not JSON`);
  }
}

async function writePrivateJson(output, value) {
  assert(typeof output === "string" && output.length <= 4096, "OIDC claim output path is invalid");
  const resolved = path.resolve(output);
  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, resolved);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  assert(typeof value === "string" && value.length > 0 && value.length <= 16_384 && !/[\r\n]/u.test(value), `${name} is missing or invalid`);
  return value;
}

async function main() {
  await captureGitHubOidcClaims();
  process.stdout.write("GitHub OIDC claims were signature-verified and captured without retaining the token.\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
