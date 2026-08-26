import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json.mjs";
import { CUT_POINTS, fixtureBundles, fixtureContext, fixtureHeader, sha256 } from "./generator.mjs";

export class FixtureVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FixtureVerificationError";
    this.code = code;
    this.details = details;
  }
}

export async function verifyFixtureLines(lines, manifest) {
  const context = await fixtureContext();
  validateManifestIdentity(manifest, context);
  const cutPoint = manifest.cutPoint.logicalResources;
  const expected = expectedLines(cutPoint, context)[Symbol.iterator]();
  const fixtureHash = createHash("sha256");
  const semanticHash = createHash("sha256");
  const introduced = new Set();
  let actualLines = 0;
  let previousLine = null;

  for await (const rawLine of lines) {
    const line = Buffer.isBuffer(rawLine) ? rawLine.toString("utf8") : rawLine;
    if (typeof line !== "string" || !line.endsWith("\n") || line.slice(0, -1).includes("\n")) {
      fail("invalid-line-framing", `fixture line ${actualLines} is not one canonical LF-terminated JSON value`);
    }
    const expectedStep = expected.next();
    if (expectedStep.done) {
      fail(line === previousLine ? "duplicate-record" : "extra-record", `fixture has an unexpected record at line ${actualLines}`);
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail("invalid-json", `fixture line ${actualLines} is invalid JSON`, { cause: error.message });
    }
    if (`${canonicalJson(record)}\n` !== line) fail("non-canonical-json", `fixture line ${actualLines} is not canonically serialized`);

    if (actualLines === 0) validateHeader(record, cutPoint, context);
    else validateReferences(record, introduced, actualLines);

    if (line !== expectedStep.value) {
      fail(line === previousLine ? "duplicate-record" : "record-mismatch", `fixture differs from the deterministic stream at line ${actualLines}`);
    }
    fixtureHash.update(line);
    if (actualLines > 0) semanticHash.update(line);
    previousLine = line;
    actualLines += 1;
  }

  if (!expected.next().done) fail("partial-fixture", `fixture ended after ${actualLines} lines`);
  const fixtureDigest = `sha256:${fixtureHash.digest("hex")}`;
  const semanticDigest = `sha256:${semanticHash.digest("hex")}`;
  if (fixtureDigest !== manifest.digests.fixture) fail("fixture-digest-mismatch", "fixture digest does not match manifest");
  if (semanticDigest !== manifest.digests.semanticRecords) fail("semantic-digest-mismatch", "semantic record digest does not match manifest");
  if (actualLines !== manifest.counts.records.total + 1) fail("record-count-mismatch", "fixture line count does not match manifest");
  return {
    result: "pass",
    cutPointResources: cutPoint,
    lines: actualLines,
    fixtureDigest,
    semanticDigest,
    manifestDigest: manifest.digests.manifest
  };
}

export function validateManifestIdentity(manifest, context) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.fixtureId !== "eacl-demo-fixture-v1") {
    fail("manifest-identity-mismatch", "fixture manifest identity is unsupported");
  }
  const cutPoint = manifest.cutPoint?.logicalResources;
  if (!CUT_POINTS.includes(cutPoint)) fail("wrong-cut-point", `unsupported fixture cut point: ${cutPoint}`);
  if (manifest.algorithm?.generatorDigest !== context.generatorDigest) fail("generator-drift", "generator source digest does not match manifest");
  if (manifest.schema?.digest !== context.schemaDigest) fail("schema-drift", "schema digest does not match manifest");
  if (manifest.exemplars?.digest !== context.exemplarDigest) fail("exemplar-drift", "exemplar digest does not match manifest");
  const payload = structuredClone(manifest);
  const claimed = payload.digests?.manifest;
  delete payload.digests.manifest;
  if (claimed !== sha256(`${canonicalJson(payload)}\n`)) fail("manifest-digest-mismatch", "manifest digest does not match canonical payload");
}

export function *expectedLines(cutPoint, context) {
  yield `${canonicalJson(fixtureHeader(cutPoint, context))}\n`;
  for (const bundle of fixtureBundles(cutPoint)) {
    for (const record of bundle.records) yield `${canonicalJson(record)}\n`;
  }
}

function validateHeader(header, cutPoint, context) {
  if (header.kind !== "fixture" || header.fixtureId !== "eacl-demo-fixture-v1") fail("fixture-header-mismatch", "fixture header identity is unsupported");
  if (header.cutPointResources !== cutPoint) fail("wrong-cut-point", "fixture header and manifest cut points differ");
  if (header.schemaDigest !== context.schemaDigest) fail("schema-drift", "fixture header schema digest differs");
  if (header.exemplarDigest !== context.exemplarDigest) fail("exemplar-drift", "fixture header exemplar digest differs");
}

function validateReferences(record, introduced, line) {
  if (record.kind === "object") {
    const key = objectKey(record.object);
    if (introduced.has(key)) fail("duplicate-object", `object ${key} appears more than once`, { line });
    introduced.add(key);
    return;
  }
  if (record.kind !== "relationship") fail("unknown-record-kind", `unknown record kind at line ${line}`);
  for (const [role, value] of [["subject", record.subject], ["resource", record.resource]]) {
    const key = objectKey(value);
    if (!introduced.has(key)) fail("dangling-relationship", `relationship ${role} ${key} has not been introduced`, { line });
  }
}

function objectKey(value) {
  return `${value.type}:${value.id}`;
}

function fail(code, message, details) {
  throw new FixtureVerificationError(code, message, details);
}
