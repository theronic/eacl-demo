import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  claimsAllowed,
  customSubject,
  generatedBundle,
  loadManifest,
  trustPolicy,
  workflowRef
} from "./github-oidc-policy.mjs";

const root = new URL("../", import.meta.url);
const manifest = await loadManifest();
const bundle = generatedBundle(manifest);
const workflowDirectory = new URL(".github/workflows/", root);
const workflowFileNames = (await readdir(workflowDirectory)).filter((name) => name.endsWith(".yml")).sort();
const workflowSources = new Map(await Promise.all(workflowFileNames.map(async (name) => [name, await readFile(new URL(name, workflowDirectory), "utf8")])));
const privilegedActions = new Set([
  "actions/checkout",
  "actions/setup-node",
  "actions/setup-java",
  "DeLaGuardo/setup-clojure",
  "actions/upload-artifact",
  "aws-actions/configure-aws-credentials"
]);
const publishedOrdinaryAuthorityIds = new Set([
  "deploy-static",
  "deploy-datahike-s3",
  "deploy-datahike-dynamodb",
  "deploy-datomic-dynamodb",
  "deploy-datalevin-memory"
]);

const claimsFor = (authority) => ({
  aud: manifest.audience,
  environment: authority.environment,
  ref: manifest.repository.deploymentRef,
  repository: manifest.repository.fullName,
  repository_id: manifest.repository.repositoryId,
  repository_owner_id: manifest.repository.ownerId,
  sub: customSubject(manifest, authority),
  workflow: authority.workflowName
});

function workflowJobs(source) {
  const lines = source.split("\n");
  const jobs = [];
  const start = lines.findIndex((line) => line === "jobs:");
  assert.ok(start >= 0, "workflow has no jobs mapping");
  for (let index = start + 1; index < lines.length;) {
    if (lines[index] && !lines[index].startsWith(" ")) break;
    const match = /^  ([a-zA-Z0-9_-]+):\s*$/u.exec(lines[index]);
    if (!match) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length && (!lines[end] || lines[end].startsWith("    "))) end += 1;
    jobs.push({ id: match[1], source: lines.slice(index, end).join("\n") });
    index = end;
  }
  return jobs;
}

function jobRoleVariable(source) {
  const assumption = /role-to-assume:\s*\$\{\{\s*(vars|env)\.([A-Z0-9_]+)\s*\}\}/u.exec(source);
  if (!assumption) return null;
  if (assumption[1] === "vars") return assumption[2];
  return new RegExp(`^\\s+${assumption[2]}:\\s*\\$\\{\\{\\s*vars\\.([A-Z0-9_]+)\\s*\\}\\}`, "mu").exec(source)?.[1] ?? null;
}

function workflowEvent(source) {
  if (/^\s{2}workflow_dispatch:/mu.test(source)) return "workflow_dispatch";
  if (/^\s{2}push:/mu.test(source)) return "push";
  return null;
}

test("every authority has an exact immutable custom subject and direct AWS claim conditions", () => {
  for (const authority of manifest.authorities) {
    const policy = trustPolicy(manifest, authority);
    const statement = policy.Statement[0];
    assert.equal(statement.Principal.Federated, manifest.providerArn);
    assert.equal(statement.Action, "sts:AssumeRoleWithWebIdentity");
    assert.deepEqual(Object.keys(statement.Condition), ["StringEquals"]);
    assert.equal(statement.Condition.StringEquals["token.actions.githubusercontent.com:sub"], [
      "repo:theronic@1011676/eacl-demo@1345904214",
      "ref:refs/heads/main",
      `workflow_ref:${workflowRef(manifest, authority)}`,
      `environment:${authority.environment}`,
      `event_name:${authority.eventName}`,
      `runner_environment:${authority.runnerEnvironment}`
    ].join(":"));
    assert.doesNotMatch(JSON.stringify(statement.Condition), /StringLike|[?*]/u);
  }
});

test("a changed repository, immutable ID, ref, workflow, subject, environment, event, or runner is denied", () => {
  const authority = manifest.authorities.find(({ id }) => id === "deploy-datomic-dynamodb");
  const policy = trustPolicy(manifest, authority);
  const accepted = claimsFor(authority);
  assert.equal(claimsAllowed(policy, accepted), true);
  for (const [claim, value] of Object.entries({
    aud: "https://github.com/theronic",
    environment: "demo-production-datahike-dynamodb",
    ref: "refs/heads/feature",
    repository: "theronic/eacl",
    repository_id: "999",
    repository_owner_id: "998",
    sub: accepted.sub.replace("deploy-demos.yml", "stateful-datomic-dynamodb.yml"),
    workflow: "Stateful Datomic DynamoDB generation"
  })) {
    assert.equal(claimsAllowed(policy, { ...accepted, [claim]: value }), false, `${claim} change was accepted`);
  }
  for (const changedSubject of [
    accepted.sub.replace("event_name:push", "event_name:workflow_dispatch"),
    accepted.sub.replace("runner_environment:github-hosted", "runner_environment:self-hosted")
  ]) {
    assert.equal(claimsAllowed(policy, { ...accepted, sub: changedSubject }), false, "subject context change was accepted");
  }
});

test("ordinary deployment authorities have no stateful role or permission scope", () => {
  const ordinary = manifest.authorities.filter(({ authorityClass }) => authorityClass === "ordinary-deployment");
  assert.deepEqual(ordinary.map(({ id }) => id).sort(), [
    "deploy-datahike-dynamodb",
    "deploy-datahike-s3",
    "deploy-datalevin-memory",
    "deploy-datomic-dynamodb",
    "deploy-static"
  ]);
  for (const authority of ordinary) {
    assert.doesNotMatch(`${authority.roleVariable}:${authority.permissionScope}`, /STATEFUL|SEED|MAINTENANCE|generation|compute/iu);
  }
  const ordinaryVariables = new Set(ordinary.map(({ roleVariable }) => roleVariable));
  for (const authority of manifest.authorities.filter(({ authorityClass }) => authorityClass !== "ordinary-deployment")) {
    assert.equal(ordinaryVariables.has(authority.roleVariable), false);
  }
});

test("every published id-token job is represented by one exact authority at job granularity", () => {
  const observed = [];
  for (const [file, source] of workflowSources) {
    const workflowName = source.match(/^name:\s*(.+)$/mu)?.[1];
    const eventName = workflowEvent(source);
    for (const job of workflowJobs(source).filter(({ source: block }) => /id-token:\s*write/u.test(block))) {
      observed.push({
        workflowFile: `.github/workflows/${file}`,
        workflowName,
        eventName,
        runnerEnvironment: /runs-on:\s*(?:ubuntu-24\.04|ubuntu-latest)/u.test(job.source) ? "github-hosted" : null,
        environment: job.source.match(/^\s{4}environment:\s*(\S+)$/mu)?.[1],
        roleVariable: jobRoleVariable(job.source)
      });
    }
  }
  const expected = manifest.authorities
    .filter(({ workflowFile }) => workflowSources.has(workflowFile.split("/").at(-1)))
    .filter((authority) => authority.authorityClass !== "ordinary-deployment" || publishedOrdinaryAuthorityIds.has(authority.id))
    .map(({ workflowFile, workflowName, eventName, runnerEnvironment, environment, roleVariable }) => ({ workflowFile, workflowName, eventName, runnerEnvironment, environment, roleVariable }))
    .sort((a, b) => `${a.workflowFile}:${a.environment}`.localeCompare(`${b.workflowFile}:${b.environment}`));
  assert.deepEqual(observed.sort((a, b) => `${a.workflowFile}:${a.environment}`.localeCompare(`${b.workflowFile}:${b.environment}`)), expected);
});

test("job discovery keeps all five active future ordinary authorities distinct inside one workflow", () => {
  const ordinary = manifest.authorities.filter(({ authorityClass }) => authorityClass === "ordinary-deployment");
  const synthetic = [
    "name: Deploy EACL demos",
    "on:",
    "  push:",
    "jobs:",
    ...ordinary.flatMap((authority) => [
      `  ${authority.id}:`,
      "    runs-on: ubuntu-24.04",
      `    environment: ${authority.environment}`,
      "    permissions:",
      "      id-token: write",
      "    steps:",
      "      - run: true"
    ])
  ].join("\n");
  const discovered = workflowJobs(synthetic).filter(({ source }) => /id-token:\s*write/u.test(source));
  assert.equal(discovered.length, 5);
  assert.deepEqual(discovered.map(({ source }) => source.match(/^\s{4}environment:\s*(\S+)$/mu)?.[1]).sort(), ordinary.map(({ environment }) => environment).sort());
});

test("the committed static job builds and deploys through one exact pinned authority", () => {
  const source = workflowSources.get("deploy-demos.yml");
  const privileged = workflowJobs(source).filter(({ source: block }) => /id-token:\s*write/u.test(block));
  const job = privileged.find(({ id }) => id === "deploy-static");
  assert.ok(job);
  assert.equal(jobRoleVariable(job.source), "AWS_STATIC_DEPLOY_ROLE_ARN");
  assert.match(job.source, /^\s{4}environment:\s*demo-production-static$/mu);
  assert.match(job.source, /npm ci[\s\S]*npm run build:static-site[\s\S]*configure-aws-credentials@[0-9a-f]{40}[\s\S]*deploy-live-demo\.mjs static/u);
  for (const [, name, revision] of job.source.matchAll(/^\s*- uses:\s*([^@\s]+)@([^\s]+)\s*(?:#.*)?$/gmu)) {
    assert.equal(privilegedActions.has(name), true, `static deployment uses an unapproved action: ${name}`);
    assert.match(revision, /^[0-9a-f]{40}$/u, `static deployment action is not commit-pinned: ${name}@${revision}`);
  }
});

test("top-level workflow identities cannot silently become reusable-workflow identities", () => {
  for (const authority of manifest.authorities.filter(({ workflowFile }) => workflowSources.has(workflowFile.split("/").at(-1)))) {
    const source = workflowSources.get(authority.workflowFile.split("/").at(-1));
    assert.doesNotMatch(source, /^\s{2}workflow_call:/mu, `${authority.id} became callable`);
    assert.doesNotMatch(source, /^\s{4}uses:\s*.+\.github\/workflows\//mu, `${authority.id} moved its OIDC job into a reusable workflow`);
  }
});

test("ordinary jobs build before AWS while stateful jobs retain isolated claim capture", () => {
  for (const authority of manifest.authorities.filter(({ workflowFile }) => workflowSources.has(workflowFile.split("/").at(-1)))
    .filter((authority) => authority.authorityClass !== "ordinary-deployment" || publishedOrdinaryAuthorityIds.has(authority.id))) {
    const source = workflowSources.get(authority.workflowFile.split("/").at(-1));
    const matches = workflowJobs(source).filter(({ source: block }) => /id-token:\s*write/u.test(block) && block.match(/^\s{4}environment:\s*(\S+)$/mu)?.[1] === authority.environment);
    assert.equal(matches.length, 1, `${authority.id} must map to exactly one OIDC job`);
    const privileged = matches[0].source;
    const capture = privileged.indexOf("node scripts/capture-github-oidc-claims.mjs");
    const credentials = privileged.indexOf("aws-actions/configure-aws-credentials@");
    assert.ok(credentials > 0, `${authority.id} does not configure AWS credentials`);
    assert.match(privileged, /persist-credentials: false/u, `${authority.id} persists the checkout credential`);
    if (authority.authorityClass === "ordinary-deployment") {
      const install = privileged.indexOf("npm ci");
      const build = privileged.search(/npm run build:/u);
      assert.ok(capture < 0, `${authority.id} retains obsolete claim-capture ceremony`);
      assert.ok(install > 0 && build > install && credentials > build,
        `${authority.id} must install and build before requesting AWS credentials`);
    } else {
      assert.ok(capture > 0, `${authority.id} does not capture OIDC claims`);
      assert.ok(credentials > capture, `${authority.id} captures claims after AWS credential configuration`);
      assert.match(privileged, new RegExp(`EACL_OIDC_AUTHORITY_ID: ${authority.id}`, "u"));
      assert.match(privileged, /EACL_OIDC_EXPECTED_SUBJECT_MODE: transition/u);
      assert.match(privileged, new RegExp(`name: oidc-claims-${authority.id}-\\$\\{\\{ github\\.run_id \\}\\}-\\$\\{\\{ github\\.run_attempt \\}\\}[\\s\\S]*retention-days: 1`, "u"));
      assert.doesNotMatch(privileged, /npm\s+(?:ci|install|run)|\b(?:pnpm|yarn|npx)\b|cache:\s*npm/u,
        `${authority.id} executes package/dependency tooling while id-token is available`);
    }
    const actions = [...privileged.matchAll(/^\s*- uses:\s*([^@\s]+)@([^\s]+)\s*(?:#.*)?$/gmu)];
    assert.ok(actions.length >= 4, `${authority.id} action closure was unexpectedly reduced`);
    for (const [, name, revision] of actions) {
      assert.equal(privilegedActions.has(name), true, `${authority.id} uses an unapproved action: ${name}`);
      assert.match(revision, /^[0-9a-f]{40}$/u, `${authority.id} action is not commit-pinned`);
    }
  }
});

test("credential-bearing checked-in entrypoints have no transitive third-party module dependency", async () => {
  const entrypoints = [
    "scripts/capture-github-oidc-claims.mjs",
    "scripts/datomic-seed-authorization.mjs",
    "scripts/deploy-live-demo.mjs"
  ].map((name) => new URL(name, root));
  const visited = new Set();
  const visit = async (url) => {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(|\bcreateRequire\b/u, `${url.pathname} uses an un-audited module loader`);
    const imports = source.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gu);
    for (const match of imports) {
      const specifier = match[1];
      if (specifier.startsWith("node:")) continue;
      assert.match(specifier, /^\.\.?\//u, `${url.pathname} imports third-party module ${specifier}`);
      const dependency = new URL(specifier, url);
      assert.ok(dependency.pathname.startsWith(root.pathname), `${url.pathname} imports outside the repository`);
      await visit(dependency);
    }
  };
  for (const entrypoint of entrypoints) await visit(entrypoint);
  assert.ok(visited.size >= entrypoints.length, "entrypoint dependency closure was not inspected");
});

test("checked-in trust bundle is deterministic and contains only required custom subjects", async () => {
  const checkedIn = JSON.parse(await readFile(new URL("infra/deployment/generated/github-oidc-trust-policies.v1.json", root), "utf8"));
  assert.deepEqual(checkedIn, bundle);
  for (const policy of Object.values(checkedIn.policies)) {
    assert.notEqual(policy.defaultEnvironmentSubjectDuringMigration, policy.requiredCustomSubject);
    assert.equal(policy.assumeRolePolicyDocument.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"], policy.requiredCustomSubject);
  }
});
