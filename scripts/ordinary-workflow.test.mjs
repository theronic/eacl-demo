import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertLiveOrdinaryTargetPairs, eligibleOrdinaryTargets, renderOrdinaryWorkflow } from "./lib/ordinary-workflow.mjs";

const committed = JSON.parse(await readFile(new URL("../build-units.json", import.meta.url), "utf8"));
const profiles = JSON.parse(await readFile(new URL("../packages/contracts/profiles.v1.json", import.meta.url), "utf8"));
const committedWorkflow = await readFile(new URL("../.github/workflows/deploy-demos.yml", import.meta.url), "utf8");

test("committed live workflow pairs match only static and direct Function URL profiles", () => {
  assert.deepEqual(assertLiveOrdinaryTargetPairs(committedWorkflow, profiles), ["datahike-dynamodb", "datahike-s3", "datalevin-memory", "datomic-dynamodb", "static"]);
  assert.throws(() => assertLiveOrdinaryTargetPairs(committedWorkflow.replace(/^  build-datahike-s3:[\s\S]*?(?=^  deploy-datahike-s3:)/mu, ""), profiles), /differ/u);
  assert.throws(() => assertLiveOrdinaryTargetPairs(`${committedWorkflow}\n  build-jank-memory:\n`, profiles), /differ/u);
});

test("committed zero-eligibility state renders no push workflow", () => {
  assert.deepEqual(eligibleOrdinaryTargets(committed), []);
  assert.equal(renderOrdinaryWorkflow(committed, { deployEntrypointAvailable: false }), null);
});

test("one qualified target is admitted without ineligible or parked siblings", () => {
  const candidate = structuredClone(committed);
  for (const unit of Object.values(candidate.units)) unit.deploymentEligible = unit.ordinaryDeploymentTarget === "static";
  candidate.units["jank-memory"].deploymentEligible = true;
  assert.deepEqual(eligibleOrdinaryTargets(candidate), ["static"]);
  const workflow = renderOrdinaryWorkflow(candidate);
  assert.match(workflow, /^on:\n  push:\n    branches:\n      - demos$/mu);
  assert.match(workflow, /^  build-static:$/mu);
  assert.match(workflow, /^  deploy-static:\n    needs: build-static$/mu);
  assert.doesNotMatch(workflow, /(?:build|deploy)-(?:datahike|datomic|datalevin|jank)/u);
  assert.doesNotMatch(workflow, /\bconcurrency:|cancel-in-progress|max-parallel|latest[-_ ]head/iu);
  const build = workflow.slice(workflow.indexOf("  build-static:"), workflow.indexOf("  deploy-static:"));
  const deploy = workflow.slice(workflow.indexOf("  deploy-static:"));
  assert.doesNotMatch(build, /id-token: write|configure-aws-credentials/u);
  assert.match(deploy, /id-token: write/u);
  assert.match(deploy, /verify-ordinary-artifact\.mjs static[\s\S]*capture-github-oidc-claims\.mjs[\s\S]*configure-aws-credentials/u);
  for (const variable of ["AWS_ACCOUNT_ID", "AWS_REGION", "STATIC_BUCKET", "CLOUDFRONT_DISTRIBUTION_ID", "PRODUCTION_CLOUDFRONT_ORIGIN"]) assert.match(deploy, new RegExp(`${variable}: \\$\\{\\{ vars\\.${variable} \\}\\}`, "u"));
});

test("eligible server targets render independent same-target edges", () => {
  const candidate = structuredClone(committed);
  candidate.units["datahike-s3"].deploymentEligible = true;
  candidate.units["datomic-dynamodb"].deploymentEligible = true;
  const workflow = renderOrdinaryWorkflow(candidate);
  assert.deepEqual(eligibleOrdinaryTargets(candidate), ["datahike-s3", "datomic-dynamodb"]);
  assert.match(workflow, /^  deploy-datahike-s3:\n    needs: build-datahike-s3$/mu);
  assert.match(workflow, /^  deploy-datomic-dynamodb:\n    needs: build-datomic-dynamodb$/mu);
  assert.doesNotMatch(workflow, /needs:\s*\[/u);
  assert.doesNotMatch(workflow, /stateful|seed|run-instances|create-table/iu);
  const datahikeDeploy = workflow.slice(workflow.indexOf("  deploy-datahike-s3:"), workflow.indexOf("  build-datomic-dynamodb:"));
  for (const variable of [
    "AWS_ACCOUNT_ID", "AWS_REGION", "ARTIFACT_BUCKET", "STATIC_BUCKET",
    "STAGED_CLOUDFRONT_DISTRIBUTION_ID", "PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID",
    "STAGED_API_CACHE_POLICY_ID", "PRODUCTION_API_CACHE_POLICY_ID",
    "STAGED_API_ORIGIN_REQUEST_POLICY_ID", "PRODUCTION_API_ORIGIN_REQUEST_POLICY_ID",
    "STAGED_API_VIEWER_REQUEST_FUNCTION_ARN", "PRODUCTION_API_VIEWER_REQUEST_FUNCTION_ARN",
    "STAGED_LAMBDA_ORIGIN_ACCESS_CONTROL_ID", "PRODUCTION_LAMBDA_ORIGIN_ACCESS_CONTROL_ID",
    "STAGED_SECURITY_HEADERS_POLICY_ID", "PRODUCTION_SECURITY_HEADERS_POLICY_ID",
    "STAGED_CLOUDFRONT_ORIGIN", "PRODUCTION_CLOUDFRONT_ORIGIN"
  ]) assert.match(datahikeDeploy, new RegExp(`${variable}: \\$\\{\\{ vars\\.${variable === "PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID" ? "CLOUDFRONT_DISTRIBUTION_ID" : variable} \\}\\}`, "u"));
  assert.match(datahikeDeploy, /PROFILE_FUNCTION_NAME: \$\{\{ vars\.DATAHIKE_S3_FUNCTION_NAME \}\}/u);
  assert.doesNotMatch(datahikeDeploy, /npm (?:ci|install)|clojure |java |setup-clojure/u);
});

test("renderer fails closed when an eligible target has no build or deploy entrypoint", () => {
  const candidate = structuredClone(committed);
  candidate.units["datalevin-memory"].deploymentEligible = true;
  assert.throws(() => renderOrdinaryWorkflow(candidate), /no deployable build/u);
  candidate.units["datalevin-memory"].deploymentEligible = false;
  candidate.units["datahike-s3"].deploymentEligible = true;
  assert.throws(() => renderOrdinaryWorkflow(candidate, { deployEntrypointAvailable: false }), /no checked-in deployment entrypoint/u);
  assert.throws(() => renderOrdinaryWorkflow(candidate, { implementedTargets: new Set() }), /deployment transaction is not implemented/u);
});

test("partial static qualification cannot publish an incomplete site", () => {
  const candidate = structuredClone(committed);
  candidate.units["explorer-main"].deploymentEligible = true;
  assert.deepEqual(eligibleOrdinaryTargets(candidate), []);
});
