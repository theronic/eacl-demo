const FORBIDDEN_ORDINARY_TERMS = [
  /\bformal(?:-verification)?\b/iu,
  /\b(?:full[- ]?)?conformance\b/iu,
  /\bplaywright\b|\baxe(?:-core)?\b/iu,
  /\bload[- ]?(?:test|sweep|campaign)\b/iu,
  /\bmemory[- ]?(?:test|sweep|sizing|campaign)\b/iu,
  /\bfault[- ]?(?:injection|campaign)\b/iu,
  /\bseed(?:ing|ed)?\b/iu,
  /\bmigrat(?:e|ion|ing)\b/iu
];

export function assertOrdinaryDemoWorkflowPolicy(source) {
  if (typeof source !== "string" || source.length < 1) throw new TypeError("ordinary workflow source is required");
  requirePattern(source, /^on:\s*\n(?:.|\n)*?^\s{2}push:\s*\n(?:.|\n)*?^\s{6}- demos\s*$/mu, "ordinary workflow must push-trigger on demos");
  requirePattern(source, /^permissions:\s*\n\s{2}contents:\s*read\s*$/mu, "ordinary workflow permissions must default to contents read");
  forbid(source, /^\s*concurrency\s*:/gmu, "ordinary workflow cannot use GitHub concurrency management");
  forbid(source, /^\s*(?:workflow_run|repository_dispatch|workflow_call|schedule|pull_request)\s*:/gmu, "ordinary workflow has a forbidden trigger");
  forbid(source, /actions\/workflows|repos\/[^\s]+\/dispatches|repository[-_]dispatch|workflow[-_]dispatch|\bgh\s+workflow\s+run\b/giu, "ordinary workflow cannot dispatch another workflow or repository");
  forbid(source, /^\s*uses:\s*[^\n]*\.github\/workflows\//gmu, "ordinary workflow cannot invoke a reusable workflow");
  forbid(source, /max-parallel|cancel-in-progress/giu, "ordinary workflow cannot limit or cancel parallel deployment");
  forbid(source, /\b(?:AWS_)?(?:STATEFUL|SEED|MAINTENANCE)(?:_[A-Z0-9]+)*_ROLE(?:_ARN)?\b/giu, "ordinary workflow cannot receive a stateful role");
  forbid(source, /\binfra\/(?:data|compute)\//giu, "ordinary workflow cannot use stateful infrastructure templates");
  forbid(source, /\baws\s+dynamodb\s+(?:create-table|delete-table|update-table|restore-table|import-table|export-table-to-point-in-time)\b/giu,
    "ordinary workflow cannot mutate DynamoDB lifecycle state");
  forbid(source, /\baws\s+ec2\s+(?:run-instances|terminate-instances|create-volume|delete-volume|allocate-address|release-address)\b/giu,
    "ordinary workflow cannot manage temporary compute");
  forbid(source, /\baws\s+s3\s+sync\b|(?:^|\s)--delete(?:\s|$)/gimu,
    "ordinary workflow cannot use broad static synchronization or deletion");
  for (const pattern of FORBIDDEN_ORDINARY_TERMS) forbid(source, pattern, "ordinary workflow includes a deep/stateful suite");
  requirePattern(source, /merge-smoke|runMergeSmoke/iu, "ordinary workflow must run bounded merge smoke");
  for (const match of source.matchAll(/^\s*-\s+uses:\s*([^\s]+)\s*$/gmu)) {
    if (!match[1].startsWith("./") && !/@[0-9a-f]{40}$/u.test(match[1])) throw new Error(`ordinary workflow action is not commit-pinned: ${match[1]}`);
  }
  assertCredentialIsolation(source);
  return true;
}

function assertCredentialIsolation(source) {
  const jobs = parseJobs(source);
  const credentialed = [...jobs.entries()].filter(([, block]) => /id-token:\s*write/u.test(block));
  if (credentialed.length === 0) throw new Error("ordinary workflow has no credentialed deploy jobs");
  for (const [jobId, block] of credentialed) {
    if (!jobId.startsWith("deploy-")) throw new Error(`${jobId} requests OIDC outside a deploy job`);
    const expectedBuild = `build-${jobId.slice("deploy-".length)}`;
    const needs = block.match(/^\s{4}needs:\s*([a-z0-9-]+)\s*$/mu)?.[1];
    if (needs !== expectedBuild) throw new Error(`${jobId} must need only ${expectedBuild}`);
    const build = jobs.get(expectedBuild);
    if (!build) throw new Error(`${jobId} has no matching build job`);
    forbid(build, /id-token:\s*write/gu, `${expectedBuild} must not receive OIDC`);
    requirePattern(build, /actions\/upload-artifact@[0-9a-f]{40}/u, `${expectedBuild} must upload an immutable handoff artifact`);
    requirePattern(block, /actions\/download-artifact@[0-9a-f]{40}/u, `${jobId} must download its build artifact`);
    requirePattern(block, /sha256sum\s+--check|verify[-_:a-z0-9 ]*digest/iu, `${jobId} must verify its artifact digest`);
    requirePattern(block, /^\s{4}environment:\s*demo-[a-z0-9-]+\s*$/mu, `${jobId} must use an exact deployment environment`);
    forbid(block, /\bnpm\s+(?:ci|install)|\bnpm\s+run\s+build|\bclojure\s+-T:build|\b(?:cmake|make|ninja)\b/giu, `${jobId} must not install dependencies or build while OIDC is available`);
  }
  for (const [jobId, block] of jobs) {
    if (!/^\s{4}needs:/mu.test(block)) continue;
    if (!credentialed.some(([credentialedId]) => credentialedId === jobId)) throw new Error(`${jobId} uses a cross-job dependency outside an isolated deploy handoff`);
  }
}

function parseJobs(source) {
  const lines = source.split(/\r?\n/u);
  const jobs = new Map();
  let inJobs = false;
  let current = null;
  for (const line of lines) {
    if (line === "jobs:") {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^[^\s]/u.test(line) && line.length > 0) break;
    const header = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*$/u);
    if (header) {
      current = header[1];
      jobs.set(current, `${line}\n`);
    } else if (current) {
      jobs.set(current, `${jobs.get(current)}${line}\n`);
    }
  }
  return jobs;
}

export function assertEaclFormalIsIndependent(demoWorkflowSource, eaclFormalWorkflowSource) {
  assertOrdinaryDemoWorkflowPolicy(demoWorkflowSource);
  if (typeof eaclFormalWorkflowSource !== "string" || eaclFormalWorkflowSource.length < 1) throw new TypeError("EACL formal workflow source is required");
  forbid(demoWorkflowSource, /theronic\/eacl\/\.github\/workflows|\bformal\b/giu, "demo deployment references the EACL formal workflow");
  forbid(eaclFormalWorkflowSource, /theronic\/eacl-demo|eacl-demo.*(?:dispatch|workflow)|(?:dispatch|workflow).*eacl-demo/giu, "EACL formal workflow triggers the demo repository");
  return true;
}

export function assertManualAssuranceWorkflows({ fullQualification, explorerQualification, explorerSpec, runtimeExercise, transitionExercise, datomicSeed, datahikeGeneration, datomicGeneration }) {
  const workflows = { fullQualification, explorerQualification, runtimeExercise, transitionExercise, datomicSeed, datahikeGeneration, datomicGeneration };
  for (const [name, source] of Object.entries(workflows)) {
    if (typeof source !== "string" || source.length < 1) throw new TypeError(`${name} workflow source is required`);
    requirePattern(source, /^on:\s*\n\s{2}workflow_dispatch:/mu, `${name} must be manually dispatched`);
    forbid(source, /^\s{2}(?:push|pull_request|schedule|workflow_run|repository_dispatch|workflow_call):/gmu, `${name} cannot run from an automatic or reusable trigger`);
  }
  requirePattern(fullQualification, /npm run qualify:http-profile/u, "full qualification workflow must execute the complete HTTP harness");
  for (const variable of ["EACL_PROFILE_ID", "EACL_DEMO_SHA", "EACL_CORE_SHA", "EACL_ARTIFACT_SHA256", "EACL_DEPLOYMENT_ID", "EACL_DATA_MANIFEST_SHA256"]) requirePattern(fullQualification, new RegExp(`\\b${variable}:`, "u"), `full qualification omits ${variable}`);
  requirePattern(fullQualification, /EACL_QUALIFICATION_TARGET_KIND:\s*staged-cloudfront/u, "full qualification must use staged CloudFront");
  requirePattern(fullQualification, /EACL_EXPECTED_STAGED_ORIGIN:\s*\$\{\{ vars\.STAGED_CLOUDFRONT_ORIGIN \}\}/u, "full qualification is not bound to the trusted staged distribution");
  requirePattern(explorerQualification, /npm run qualify:explorer/u, "browser workflow must execute explorer qualification");
  requirePattern(explorerQualification, /npm run build:static-site/u, "browser workflow must build the complete main and DataScript site");
  requirePattern(explorerQualification, /npm run qualify:datascript-browser/u, "browser workflow omits the DataScript worker exercise");
  requirePattern(explorerQualification, /npm run qualify:main-network-isolation/u, "browser workflow omits main-bundle network isolation");
  requirePattern(explorerQualification, /EXPECTED_STAGED_ORIGIN:\s*\$\{\{ vars\.STAGED_CLOUDFRONT_ORIGIN \}\}/u, "browser workflow is not bound to the trusted staged distribution");
  for (const browser of ["chromium", "firefox", "webkit"]) requirePattern(explorerQualification, new RegExp(`\\b${browser}\\b`, "u"), `browser workflow omits ${browser}`);
  if (typeof explorerSpec !== "string" || !/@axe-core\/playwright/u.test(explorerSpec) || !/analyze\(\)/u.test(explorerSpec)) throw new Error("explorer workflow does not execute an accessibility audit");

  for (const option of ["load", "memory", "fault"]) requirePattern(runtimeExercise, new RegExp(`^\\s{10}- ${option}$`, "mu"), `runtime exercise omits ${option}`);
  requirePattern(runtimeExercise, /npm run exercise:profile-runtime/u, "runtime exercise does not execute the bounded evidence runner");
  requirePattern(runtimeExercise, /EXERCISE:<exercise>:<profile>:<deployment-id>/u, "runtime exercise lacks typed confirmation");
  requirePattern(runtimeExercise, /EACL_EXPECTED_STAGED_ORIGIN:\s*\$\{\{ vars\.STAGED_CLOUDFRONT_ORIGIN \}\}/u, "runtime exercise is not bound to the trusted staged distribution");
  requirePattern(runtimeExercise, /request_count:[\s\S]*default:\s*["']100["']/u, "runtime exercise lacks a conservative request default");
  requirePattern(runtimeExercise, /concurrency:[\s\S]*default:\s*["']2["']/u, "runtime exercise lacks a conservative concurrency default");
  requirePattern(runtimeExercise, /inputs\.exercise == 'memory'[\s\S]*id-token:\s*write/u, "only the memory job may request AWS OIDC");
  forbid(runtimeExercise.match(/http-exercise:[\s\S]*?memory-exercise:/u)?.[0] ?? "", /id-token:\s*write/gu, "HTTP load/fault job cannot request AWS OIDC");

  for (const option of ["migration", "rollback"]) requirePattern(transitionExercise, new RegExp(`^\\s{10}- ${option}$`, "mu"), `transition exercise omits ${option}`);
  requirePattern(transitionExercise, /ALIAS_NAME:\s*exercise/u, "transition rehearsal must use the dedicated exercise alias");
  requirePattern(transitionExercise, /EXPECTED_STAGED_ORIGIN:\s*\$\{\{ vars\.STAGED_CLOUDFRONT_ORIGIN \}\}/u, "transition rehearsal is not bound to the trusted staged distribution");
  forbid(transitionExercise, /ALIAS_NAME:\s*live|--name\s+["']?live/u, "transition rehearsal cannot touch the live alias");
  requirePattern(transitionExercise, /aws lambda update-alias[\s\S]*--revision-id/u, "transition rehearsal lacks optimistic alias mutation");
  requirePattern(transitionExercise, /kind === ["']migration["'][\s\S]*BigInt\(target\) > BigInt\(from\)[\s\S]*kind === ["']rollback["'][\s\S]*BigInt\(target\) < BigInt\(from\)/u, "transition rehearsal does not distinguish forward migration from rollback");
  requirePattern(transitionExercise, /aws lambda list-tags[\s\S]*Tags\?\.Profile/u, "transition rehearsal does not bind the function to the requested profile");
  requirePattern(transitionExercise, /name: Restore only the exact exercise alias state[\s\S]*if:\s*always\(\)/u, "transition rehearsal lacks unconditional exact restore");
  requirePattern(transitionExercise, /target-alias\.json[\s\S]*current_version[\s\S]*target_revision/u, "transition restore does not reject alias drift");
  requirePattern(transitionExercise, /node scripts\/run-transition-smoke\.mjs/gmu, "transition rehearsal lacks staged semantic evidence");

  requirePattern(datomicSeed, /options:\s*\n\s{10}- preview\s*\n\s{10}- execute/mu, "Datomic seed workflow lacks explicit preview/execute separation");
  requirePattern(datomicSeed, /node scripts\/datomic-seed-authorization\.mjs authorize/u, "Datomic seed execution lacks immutable authorization");
  requirePattern(datomicSeed, /if:\s*always\(\)[\s\S]*(?:terminate-instances|remaining_instances)/u, "Datomic seed workflow lacks unconditional exact cleanup");
  for (const source of [datahikeGeneration, datomicGeneration]) {
    requirePattern(source, /preview-create/u, "stateful generation workflow lacks preview");
    requirePattern(source, /publish-serving/u, "stateful generation workflow lacks explicit publication");
    requirePattern(source, /github\.ref == 'refs\/heads\/demos'/u, "stateful generation workflow is not demos-ref restricted");
  }
  return true;
}

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(source, pattern, message) {
  pattern.lastIndex = 0;
  if (pattern.test(source)) throw new Error(message);
}
