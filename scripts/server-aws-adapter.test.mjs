import assert from "node:assert/strict";
import test from "node:test";

import { createServerAwsAdapter } from "./lib/server-aws-adapter.mjs";

const profileId = "datahike-s3";
const functionName = "eacl-demo-datahike-s3-prod";
const current = { functionName, aliasName: "candidate", functionVersion: "7", revisionId: "candidate-revision-7" };
const prior = { ...current, functionVersion: "6", revisionId: "candidate-revision-6" };

test("ambiguous alias promotion and rollback reconcile the observed exact revisions", async () => {
  let alias = awsAlias("candidate", "7", "candidate-revision-7");
  const adapter = create({ runAws(args) {
    if (command(args, "lambda", "update-alias")) {
      const version = value(args, "--function-version");
      alias = awsAlias("candidate", version, version === "8" ? "candidate-revision-8" : "candidate-revision-restored");
      return { ok: false, stdout: "", stderr: "response lost" };
    }
    if (command(args, "lambda", "get-alias")) return ok(alias);
    throw new Error(`unexpected AWS command: ${args.slice(0, 2).join(" ")}`);
  } });
  const promoted = await adapter.moveAlias({ currentAlias: current, toVersion: "8", description: "candidate deploy-8" });
  assert.deepEqual(promoted, { functionName, aliasName: "candidate", functionVersion: "8", revisionId: "candidate-revision-8" });
  const restored = await adapter.restoreAlias({ currentAlias: promoted, priorAlias: prior });
  assert.deepEqual(restored, { functionName, aliasName: "candidate", functionVersion: "6", revisionId: "candidate-revision-restored" });
});

test("ambiguous alias update refuses to overwrite or roll back a newer run", async () => {
  let alias = awsAlias("candidate", "7", "candidate-revision-7");
  const adapter = create({ runAws(args) {
    if (command(args, "lambda", "update-alias")) {
      alias = awsAlias("candidate", "9", "candidate-revision-newer");
      return { ok: false, stdout: "", stderr: "response lost" };
    }
    if (command(args, "lambda", "get-alias")) return ok(alias);
    throw new Error(`unexpected AWS command: ${args.slice(0, 2).join(" ")}`);
  } });
  await assert.rejects(() => adapter.moveAlias({ currentAlias: current, toVersion: "8", description: "candidate deploy-8" }), /newer candidate alias revision/u);
  assert.equal(alias.FunctionVersion, "9");
});

test("foundation validation binds both CloudFront routes to every exact edge policy and alias URL", async () => {
  const adapter = create({ runAws: foundationRunAws() });
  await adapter.assertFoundation({ profileId });
});

test("foundation validation rejects a same-distribution route with a different edge policy", async () => {
  const adapter = create({ runAws: foundationRunAws({ driftOriginRequestPolicy: true }) });
  await assert.rejects(() => adapter.assertFoundation({ profileId }), /exact non-cached profile route/u);
});

function create({ runAws }) {
  return createServerAwsAdapter({
    root: "/Users/petrus/code/eacl/eacl-demo",
    accountId: "843761893873",
    region: "us-east-1",
    profileId,
    functionName,
    artifactBucket: "eacl-demo-artifacts-843761893873",
    statusBucket: "eacl-demo-static-843761893873",
    stagedDistributionId: "E1234567890",
    productionDistributionId: "E0987654321",
    stagedApiCachePolicyId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    productionApiCachePolicyId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    stagedApiOriginRequestPolicyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    productionApiOriginRequestPolicyId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    stagedApiViewerRequestFunctionArn: "arn:aws:cloudfront::843761893873:function/eacl-demo-staged-api-gate",
    productionApiViewerRequestFunctionArn: "arn:aws:cloudfront::843761893873:function/eacl-demo-production-api-gate",
    stagedLambdaOriginAccessControlId: "E1111111111",
    productionLambdaOriginAccessControlId: "E2222222222",
    stagedSecurityHeadersPolicyId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    productionSecurityHeadersPolicyId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    stagedOrigin: "https://staging.demo.eacl.dev/",
    productionOrigin: "https://demo.eacl.dev/",
    profileDefinitions: { profiles: [{ id: profileId, backend: "datahike", storage: "s3" }] },
    baseRegistry: { profiles: [{ id: profileId }] },
    runAws,
    fetchImpl: async () => { throw new Error("unexpected fetch"); }
  });
}

function awsAlias(name, version, revision) { return { FunctionName: functionName, Name: name, FunctionVersion: version, RevisionId: revision }; }
function command(args, service, operation) { return args[0] === service && args[1] === operation; }
function value(args, flag) { return args[args.indexOf(flag) + 1]; }
function ok(value) { return { ok: true, stdout: JSON.stringify(value), stderr: "" }; }

function foundationRunAws({ driftOriginRequestPolicy = false } = {}) {
  return (args) => {
    if (command(args, "sts", "get-caller-identity")) return ok({ Account: "843761893873", Arn: "arn:aws:sts::843761893873:assumed-role/eacl-demo-deploy/run" });
    if (command(args, "s3api", "get-bucket-versioning")) return ok({ Status: "Enabled" });
    if (command(args, "s3api", "get-public-access-block")) return ok({ PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } });
    if (command(args, "s3api", "get-bucket-ownership-controls")) return ok({ OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] } });
    if (command(args, "s3api", "get-bucket-encryption")) return ok({ ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] } });
    if (command(args, "s3api", "get-bucket-tagging")) {
      const component = value(args, "--bucket").includes("artifacts") ? "artifacts" : "static";
      return ok({ TagSet: [{ Key: "Project", Value: "eacl-demo" }, { Key: "Component", Value: component }] });
    }
    if (command(args, "lambda", "get-function-configuration")) return ok({
      FunctionName: functionName,
      FunctionArn: `arn:aws:lambda:us-east-1:843761893873:function:${functionName}`,
      Runtime: "java25",
      Handler: "eacl_demo.datahike_s3.LambdaHandler::handleRequest",
      PackageType: "Zip",
      Architectures: ["arm64"],
      State: "Active",
      LastUpdateStatus: "Successful",
      SnapStart: { ApplyOn: "None" },
      RevisionId: "function-revision-7"
    });
    if (command(args, "lambda", "list-tags")) return ok({ Tags: { Project: "eacl-demo", Profile: profileId } });
    if (command(args, "lambda", "get-function-url-config")) {
      const qualifier = value(args, "--qualifier");
      return ok({ FunctionUrl: `https://${qualifier}-id.lambda-url.us-east-1.on.aws/`, AuthType: "AWS_IAM", InvokeMode: "BUFFERED" });
    }
    if (command(args, "cloudfront", "get-distribution")) {
      const staged = value(args, "--id") === "E1234567890";
      const alias = staged ? "candidate" : "live";
      const originRequestPolicyId = staged ? "cccccccc-cccc-cccc-cccc-cccccccccccc" : "dddddddd-dddd-dddd-dddd-dddddddddddd";
      return ok({ Distribution: {
        Id: staged ? "E1234567890" : "E0987654321",
        Status: "Deployed",
        DomainName: staged ? "d-staged.cloudfront.net" : "d-production.cloudfront.net",
        DistributionConfig: {
          Enabled: true,
          Aliases: { Items: [staged ? "staging.demo.eacl.dev" : "demo.eacl.dev"] },
          CacheBehaviors: { Items: [{
            PathPattern: `api/v1/${profileId}/*`,
            TargetOriginId: profileId,
            AllowedMethods: { Items: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"], CachedMethods: { Items: ["GET", "HEAD"] } },
            CachePolicyId: staged ? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            OriginRequestPolicyId: driftOriginRequestPolicy && staged ? "99999999-9999-9999-9999-999999999999" : originRequestPolicyId,
            ResponseHeadersPolicyId: staged ? "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" : "ffffffff-ffff-ffff-ffff-ffffffffffff",
            ViewerProtocolPolicy: "redirect-to-https",
            Compress: false,
            FunctionAssociations: { Quantity: 1, Items: [{ EventType: "viewer-request", FunctionARN: `arn:aws:cloudfront::843761893873:function/eacl-demo-${staged ? "staged" : "production"}-api-gate` }] }
          }] },
          Origins: { Items: [{
            Id: profileId,
            DomainName: `${alias}-id.lambda-url.us-east-1.on.aws`,
            OriginPath: "",
            OriginAccessControlId: staged ? "E1111111111" : "E2222222222",
            OriginCustomHeaders: { Quantity: 0 },
            CustomOriginConfig: { OriginProtocolPolicy: "https-only", OriginSslProtocols: { Items: ["TLSv1.2"] } }
          }] }
        }
      } });
    }
    throw new Error(`unexpected AWS command: ${args.slice(0, 2).join(" ")}`);
  };
}
