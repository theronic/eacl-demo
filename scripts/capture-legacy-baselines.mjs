#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const captureDate = process.env.EACL_DEMO_CAPTURE_DATE ?? "2026-08-25";
const baselineDir = resolve(
  process.env.EACL_DEMO_BASELINE_DIR
    ?? join(repoRoot, "docs", "provenance", "baselines", captureDate),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileRecord(fileName) {
  const absolute = join(baselineDir, fileName);
  if (!existsSync(absolute)) throw new Error(`Required baseline file is missing: ${absolute}`);
  const bytes = readFileSync(absolute);
  return { file: fileName, bytes: bytes.length, sha256: sha256(bytes) };
}

async function request(url, expectedContentType = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    if (expectedContentType && !contentType.includes(expectedContentType)) {
      throw new Error(`${url} returned ${contentType || "no content type"}, expected ${expectedContentType}`);
    }
    return {
      url,
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      headers: {
        "cache-control": response.headers.get("cache-control"),
        "content-type": contentType,
        date: response.headers.get("date"),
        etag: response.headers.get("etag"),
        server: response.headers.get("server"),
        via: response.headers.get("via"),
        "x-cache": response.headers.get("x-cache"),
      },
      body,
      sha256: sha256(body),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function captureJson(fileName, url) {
  const response = await request(url, "application/json");
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const parsed = JSON.parse(response.body.toString("utf8"));
  const normalized = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  writeFileSync(join(baselineDir, fileName), normalized);
  const { body: _body, ...metadata } = response;
  return {
    ...metadata,
    rawResponseSha256: response.sha256,
    file: fileName,
    fileSha256: sha256(normalized),
    identity: {
      status: parsed?.data?.status ?? parsed?.status ?? null,
      revision: parsed?.meta?.revision ?? null,
      basis: parsed?.meta?.basis ?? null,
      totals: parsed?.data?.totals ?? null,
    },
  };
}

async function unsupportedProbe(url) {
  const response = await request(url);
  const { body, ...metadata } = response;
  return {
    ...metadata,
    bodyBytes: body.length,
    bodySha256: sha256(body),
    expected: "not-supported-browser-only",
  };
}

mkdirSync(baselineDir, { recursive: true });

const ec2Health = await captureJson(
  "datahike-ec2-health.json",
  "https://demo.eacl.dev/datahike/api/health",
);
const ec2Bootstrap = await captureJson(
  "datahike-ec2-bootstrap.json",
  "https://demo.eacl.dev/datahike/api/bootstrap",
);
const serverlessHealth = await captureJson(
  "datahike-serverless-health.json",
  "https://serverless-datahike.demo.eacl.dev/datahike/api/health",
);
const serverlessBootstrap = await captureJson(
  "datahike-serverless-bootstrap.json",
  "https://serverless-datahike.demo.eacl.dev/datahike/api/bootstrap",
);

const datascriptHealthProbe = await unsupportedProbe("https://explorer.eacl.dev/api/health");
const datascriptBootstrapProbe = await unsupportedProbe("https://explorer.eacl.dev/api/bootstrap");

const manifest = {
  schema: "eacl-demo.legacy-baselines.v1",
  capturedAt: new Date().toISOString(),
  captureDate,
  method: {
    screenshots: "Full-page screenshots captured after DOMContentLoaded and a four-second readiness wait in the connected Chromium-family browser.",
    api: "Direct bounded GET requests with JSON parsing and response/file SHA-256 digests.",
    datascript: "The browser-only legacy app has no health/bootstrap HTTP API; 404 probes plus rendered browser-state JSON record that limitation.",
  },
  surfaces: {
    "datahike-ec2": {
      reachable: true,
      uiUrl: "https://demo.eacl.dev/datahike/",
      screenshot: fileRecord("datahike-ec2.png"),
      health: ec2Health,
      bootstrap: ec2Bootstrap,
    },
    "datahike-serverless": {
      reachable: true,
      uiUrl: "https://serverless-datahike.demo.eacl.dev/datahike/",
      screenshot: fileRecord("datahike-serverless.png"),
      health: serverlessHealth,
      bootstrap: serverlessBootstrap,
    },
    "datascript-browser": {
      reachable: true,
      uiUrl: "https://explorer.eacl.dev/",
      screenshot: fileRecord("datascript-explorer.png"),
      browserState: fileRecord("datascript-browser-state.json"),
      health: datascriptHealthProbe,
      bootstrap: datascriptBootstrapProbe,
    },
  },
  notPubliclyReachable: [
    { profile: "datomic", reason: "No deployed public Datomic demo was present in the captured AWS/DNS estate." },
    { profile: "datalevin", reason: "No deployed public Datalevin demo was present in the captured AWS/DNS estate." },
    { profile: "jank", reason: "No deployed public Jank demo was present in the captured AWS/DNS estate." },
  ],
};

writeFileSync(join(baselineDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(join(baselineDir, "manifest.json"));
