import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const workflow = await readFile(new URL(".github/workflows/deploy-demos.yml", root), "utf8");
const profiles = JSON.parse(await readFile(new URL("packages/contracts/profiles.v1.json", root), "utf8"));

const expected = Object.freeze({
  "deploy-static": {
    environment: "demo-production-static",
    build: "npm run build:static-site",
    deploy: "node scripts/deploy-live-demo.mjs static",
    role: "AWS_STATIC_DEPLOY_ROLE_ARN"
  },
  "deploy-datahike-s3": {
    environment: "demo-production-datahike-s3",
    build: "npm run build:datahike-s3-lambda",
    deploy: "node scripts/deploy-live-demo.mjs datahike-s3",
    role: "AWS_DATAHIKE_S3_DEPLOY_ROLE_ARN"
  },
  "deploy-datahike-dynamodb": {
    environment: "demo-production-datahike-dynamodb",
    build: "npm run build:datahike-dynamodb-lambda",
    deploy: "node scripts/deploy-live-demo.mjs datahike-dynamodb",
    role: "AWS_DATAHIKE_DYNAMODB_DEPLOY_ROLE_ARN"
  },
  "deploy-datomic-dynamodb": {
    environment: "demo-production-datomic-dynamodb",
    build: "npm run build:datomic-lambda",
    deploy: "node scripts/deploy-live-demo.mjs datomic-dynamodb",
    role: "AWS_DATOMIC_DYNAMODB_DEPLOY_ROLE_ARN"
  },
  "deploy-datalevin-memory": {
    environment: "demo-production-datalevin-memory",
    build: "npm run build:datalevin-memory-lambda",
    deploy: "node scripts/deploy-live-demo.mjs datalevin-memory",
    role: "AWS_DATALEVIN_MEMORY_DEPLOY_ROLE_ARN"
  }
});

test("a production push builds and deploys every live demo directly", () => {
  assert.match(workflow, /^on:\s*\n\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- production$/mu);
  const jobs = parseJobs(workflow);
  assert.deepEqual([...jobs.keys()].sort(), Object.keys(expected).sort());

  for (const [jobId, definition] of Object.entries(expected)) {
    const source = jobs.get(jobId);
    assert.match(source, new RegExp(`^\\s{4}environment: ${definition.environment}$`, "mu"));
    assert.match(source, /id-token:\s*write/u);
    assert.match(source, /persist-credentials: false/u);
    assert.match(source,
      /actions\/cache@[0-9a-f]{40}[\s\S]*?path: ~\/\.m2\/repository[\s\S]*?key: maven-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ github\.job \}\}-\$\{\{ hashFiles\('deps\.edn'\) \}\}/u,
      `${jobId} must cache Maven dependencies with a job-specific locked key`);
    assert.match(source, new RegExp(`role-to-assume: \\$\\{\\{ vars\\.${definition.role} \\}\\}`, "u"));
    const install = source.indexOf("npm ci");
    const build = source.indexOf(definition.build);
    const credentials = source.indexOf("aws-actions/configure-aws-credentials@");
    const deploy = source.indexOf(definition.deploy);
    assert.ok(install > 0 && build > install && credentials > build && deploy > credentials,
      `${jobId} must install, build, authenticate, and deploy in that order`);
  }
});

test("the deployment workflow has no certification or artifact-handoff graph", () => {
  assert.doesNotMatch(workflow, /^\s{4}needs:/mu);
  assert.doesNotMatch(workflow, /^\s{2}build-/mu);
  assert.doesNotMatch(workflow,
    /upload-artifact|download-artifact|capture-github-oidc-claims|change-readiness|qualification|determinism/iu);
  assert.doesNotMatch(workflow, /^\s*concurrency:/mu);
  for (const [, action, revision] of workflow.matchAll(/^\s*- uses:\s*([^@\s]+)@([^\s]+)$/gmu)) {
    assert.match(revision, /^[0-9a-f]{40}$/u, `${action} is not commit-pinned`);
  }
});

test("the workflow target set matches the public live-demo catalog", () => {
  const catalog = [
    "deploy-static",
    ...profiles.profiles
      .filter(({ apiOrigin }) => typeof apiOrigin === "string" && apiOrigin.length > 0)
      .map(({ id }) => `deploy-${id}`)
  ].sort();
  assert.deepEqual(Object.keys(expected).sort(), catalog);
});

function parseJobs(source) {
  const lines = source.split(/\r?\n/u);
  const jobs = new Map();
  let current = null;
  let inJobs = false;
  for (const line of lines) {
    if (line === "jobs:") {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^[^\s]/u.test(line) && line.length > 0) break;
    const header = /^\s{2}([a-z0-9-]+):\s*$/u.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, `${line}\n`);
    } else if (current) {
      jobs.set(current, `${jobs.get(current)}${line}\n`);
    }
  }
  return jobs;
}
