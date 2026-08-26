import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import baseRegistry from "../registry/profile-registry.v1.json" with { type: "json" };
import profileDefinitions from "../packages/contracts/profiles.v1.json" with { type: "json" };
import responseSchema from "../schemas/explorer-response.v1.schema.json" with { type: "json" };
import { createRuntimeBoundaryValidator } from "../packages/contracts/src/runtime-validation.mjs";
import { createProfilePublication } from "../packages/explorer-state/src/profile-publication.mjs";
import { summarizeDemoSmoke } from "./lib/demo-smoke-result.mjs";

const root = path.resolve(import.meta.dirname, "..");
const validateLiveResponse = createRuntimeBoundaryValidator(
  { responseSchema },
  "https://demo.eacl.dev/schemas/explorer-response.v1.schema.json",
  "liveDeploymentResponse"
);
const target = process.argv[2];
const profiles = {
  "datahike-s3": {
    artifact: "dist/datahike-s3/function.jar",
    functionName: "eacl-demo-datahike-s3-live",
    snapStart: false
  },
  "datomic-dynamodb": {
    artifact: "dist/datomic-dynamodb/function.jar",
    functionName: "eacl-demo-datomic-dynamodb-live",
    snapStart: false
  },
  "datalevin-memory": {
    artifact: "dist/datalevin-memory/function.jar",
    functionName: "eacl-demo-datalevin-memory-live",
    snapStart: true
  }
};

if (target === "static") await deployStatic();
else if (profiles[target]) await deployProfile(target, profiles[target]);
else throw new Error(`target must be static or one of ${Object.keys(profiles).join(", ")}`);

async function deployStatic() {
  const bucket = required("STATIC_BUCKET");
  const distribution = required("CLOUDFRONT_DISTRIBUTION_ID");
  const manifest = JSON.parse(await readFile(path.join(root, "dist/static-site/site-manifest.json"), "utf8"));
  if (manifest.schema !== "eacl-demo.static-site.v1" || manifest.result !== "assembled") {
    throw new Error("static manifest is invalid");
  }
  for (const file of manifest.files) {
    const absolute = path.join(root, "dist/static-site", file.path);
    const digest = createHash("sha256").update(await readFile(absolute)).digest("hex");
    if (digest !== file.sha256) throw new Error(`static digest mismatch: ${file.path}`);
    aws([
      "s3api", "put-object", "--bucket", bucket, "--key", file.path,
      "--body", absolute, "--content-type", contentType(file.path),
      "--cache-control", file.cacheClass === "immutable"
        ? "public,max-age=31536000,immutable"
        : "no-cache,no-store,must-revalidate",
      "--server-side-encryption", "AES256",
      "--metadata", `sha256=${digest},demo-sha=${demoSha()}`
    ]);
  }
  aws(["cloudfront", "create-invalidation", "--distribution-id", distribution,
       "--paths", "/index.html", "/datascript/index.html"]);
  const workerPath = manifest.entries.datascriptWorker;
  const worker = manifest.files.find((file) => file.path === workerPath);
  if (!worker) throw new Error("DataScript worker is absent from the static manifest");
  await publishProfile({
    profileId: "datascript-browser-memory",
    artifactKind: "browser-worker",
    artifactSha: worker.sha256,
    artifactVersion: worker.path,
    dataManifestSha: "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a",
    evidence: worker.sha256
  });
  process.stdout.write(`deployed static ${demoSha()}\n`);
}

async function deployProfile(profileId, profile) {
  const artifactBucket = required("ARTIFACT_BUCKET");
  const artifactPath = path.join(root, profile.artifact);
  const artifactSha = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  const key = `artifacts/${profileId}/${demoSha()}/${artifactSha}.jar`;
  const uploaded = awsJson([
    "s3api", "put-object", "--bucket", artifactBucket, "--key", key,
    "--body", artifactPath, "--server-side-encryption", "AES256",
    "--metadata", `artifact-sha256=${artifactSha},demo-sha=${demoSha()},eacl-sha=${eaclSha()}`
  ]);
  if (!uploaded.VersionId) throw new Error("artifact bucket must be versioned");

  const current = awsJson(["lambda", "get-function-configuration",
                           "--function-name", profile.functionName]);
  const deploymentId = `demos:${demoSha()}:${profileId}`;
  const variables = { ...(current.Environment?.Variables ?? {}),
    EACL_ARTIFACT_SHA256: artifactSha,
    EACL_CORE_SHA: eaclSha(),
    EACL_DEMO_SHA: demoSha(),
    EACL_DEPLOYMENT_ID: deploymentId
  };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-demo-deploy-"));
  try {
    const environmentFile = path.join(temporary, "environment.json");
    await writeFile(environmentFile, `${JSON.stringify({ Variables: variables })}\n`, { mode: 0o600 });
    const configuration = ["lambda", "update-function-configuration",
      "--function-name", profile.functionName,
      "--environment", `file://${environmentFile}`];
    if (profile.snapStart) configuration.push("--snap-start", "ApplyOn=PublishedVersions");
    aws(configuration);
    aws(["lambda", "wait", "function-updated-v2", "--function-name", profile.functionName]);
    const update = awsJson([
      "lambda", "update-function-code", "--function-name", profile.functionName,
      "--s3-bucket", artifactBucket, "--s3-key", key,
      "--s3-object-version", uploaded.VersionId, "--publish"
    ]);
    if (!/^[1-9][0-9]*$/.test(update.Version)) throw new Error("Lambda did not publish a version");
    aws(["lambda", "wait", "function-updated-v2", "--function-name", profile.functionName]);
    if (profile.snapStart) {
      aws(["lambda", "wait", "published-version-active", "--function-name",
           profile.functionName, "--qualifier", update.Version]);
      const published = awsJson(["lambda", "get-function-configuration",
        "--function-name", profile.functionName, "--qualifier", update.Version]);
      if (published.SnapStart?.ApplyOn !== "PublishedVersions" ||
          published.SnapStart?.OptimizationStatus !== "On") {
        throw new Error("Datalevin SnapStart version is not optimized");
      }
    }
    aws(["lambda", "update-alias", "--function-name", profile.functionName,
         "--name", "candidate", "--function-version", update.Version,
         "--description", `demos:${demoSha()}:${artifactSha}`]);
    const smoke = await smokeProfile(profileId, profile.functionName, temporary, {
      profileId,
      demoSha: demoSha(),
      eaclSha: eaclSha(),
      artifactSha256: artifactSha,
      deploymentId
    });
    await publishProfile({
      profileId,
      artifactKind: "lambda-version",
      artifactSha,
      artifactVersion: update.Version,
      dataManifestSha: smoke.dataManifestSha,
      evidence: createHash("sha256").update(smoke.evidence).digest("hex")
    });
    process.stdout.write(`deployed ${profileId} version ${update.Version} sha256:${artifactSha}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function smokeProfile(profileId, functionName, temporary, expectedIdentity) {
  const health = await invokeProfile({ profileId, functionName, temporary,
    operation: "health", method: "GET", input: null });
  assertHealthy(profileId, health);
  process.stdout.write(`${profileId} candidate ${profileId === "datalevin-memory" ? "restore" : "cold"} health ${health.wallMs}ms\n`);
  const bootstrap = await invokeProfile({ profileId, functionName, temporary,
    operation: "bootstrap", method: "GET", input: null });
  if (bootstrap.statusCode !== 200 || !("data" in bootstrap.envelope) ||
      "error" in bootstrap.envelope ||
      bootstrap.envelope.data?.identity?.profileId !== profileId ||
      bootstrap.envelope.data?.runtime?.snapStart !==
        (profileId === "datalevin-memory" ? "enabled" : "disabled")) {
    throw new Error(`${profileId} bootstrap smoke failed`);
  }
  const decisions = [];
  for (const [subjectId, expected] of [["user-1", true], ["user-2", false]]) {
    const response = await invokeProfile({ profileId, functionName, temporary,
      operation: "authorize", method: "POST",
      input: { subjectType: "user", subjectId, resourceType: "account",
        resourceId: "account-0", permission: "admin" } });
    if (response.statusCode !== 200 || !("data" in response.envelope) ||
        "error" in response.envelope ||
        response.envelope.data?.allowed !== expected) {
      throw new Error(`${profileId} ${expected ? "allow" : "deny"} smoke failed`);
    }
    decisions.push(response);
  }
  const mutation = await invokeProfile({ profileId, functionName, temporary,
    operation: "seed", method: "POST", input: {} });
  if (mutation.statusCode !== 404 || !("error" in mutation.envelope) ||
      "data" in mutation.envelope ||
      mutation.envelope.error?.code !== "route-not-found") {
    throw new Error(`${profileId} mutation denial smoke failed`);
  }
  return summarizeDemoSmoke({ profileId, expectedIdentity, health, bootstrap, decisions, mutation });
}

async function invokeProfile({ profileId, functionName, temporary,
  operation, method, input }) {
  const eventFile = path.join(temporary, "health-event.json");
  const outputFile = path.join(temporary, "health-response.json");
  await writeFile(eventFile, JSON.stringify({
    version: "2.0", routeKey: "$default",
    rawPath: `/api/v1/${profileId}/${operation}`, rawQueryString: "",
    headers: input === null ? {} : { "content-type": "application/json" },
    requestContext: { requestId: `ci-${operation}-${demoSha().slice(0, 12)}`,
      http: { method } }, isBase64Encoded: false,
    body: input === null ? null : JSON.stringify(input)
  }));
  const started = Date.now();
  aws(["lambda", "invoke", "--function-name", `${functionName}:candidate`,
       "--cli-binary-format", "raw-in-base64-out", "--payload", `fileb://${eventFile}`,
       outputFile]);
  const response = JSON.parse(await readFile(outputFile, "utf8"));
  return { statusCode: response.statusCode,
    envelope: validateLiveResponse(JSON.parse(response.body)),
    wallMs: Date.now() - started };
}

function assertHealthy(profileId, response) {
  const body = response.envelope;
  if (response.statusCode !== 200 || !("data" in body) || "error" in body ||
      body.data?.ready !== true ||
      body.data?.identity?.demoSha !== demoSha() ||
      body.data?.identity?.eaclSha !== eaclSha()) {
    throw new Error(`${profileId} health smoke failed`);
  }
}

async function publishProfile({ profileId, artifactKind, artifactSha,
  artifactVersion, dataManifestSha, evidence }) {
  const base = baseRegistry.profiles.find((candidate) => candidate.id === profileId);
  const definition = profileDefinitions.profiles.find((candidate) => candidate.id === profileId);
  if (!base || !definition) throw new Error(`unknown publication profile: ${profileId}`);
  const deployedAt = new Date().toISOString();
  const deployment = {
    demoSha: demoSha(), eaclSha: eaclSha(),
    artifact: { kind: artifactKind, sha256: artifactSha, version: artifactVersion },
    deploymentId: `demos:${demoSha()}:${profileId}`,
    dataManifestSha256: dataManifestSha, deployedAt
  };
  const profile = { ...structuredClone(base), state: "enabled", reason: null,
    deployment,
    lastOutcome: { outcome: "succeeded", attemptedDemoSha: demoSha(),
      attemptedEaclSha: eaclSha(), artifactSha256: artifactSha, at: deployedAt,
      message: "The demos-branch build and bounded live smoke passed." }
  };
  const publication = await createProfilePublication({ profile, definition,
    publishedAt: deployedAt,
    gate: { kind: "demo-smoke", evidenceId: `sha256:${evidence}` } });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-demo-publication-"));
  try {
    const file = path.join(temporary, `${profileId}.json`);
    await writeFile(file, `${JSON.stringify(publication, null, 2)}\n`);
    aws(["s3api", "put-object", "--bucket", required("STATIC_BUCKET"),
         "--key", `registry/profiles/${profileId}.json`, "--body", file,
         "--content-type", "application/json; charset=utf-8",
         "--cache-control", "no-cache,no-store,must-revalidate",
         "--server-side-encryption", "AES256"]);
    aws(["cloudfront", "create-invalidation", "--distribution-id",
         required("CLOUDFRONT_DISTRIBUTION_ID"), "--paths",
         `/registry/profiles/${profileId}.json`]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function aws(args) {
  const result = spawnSync("aws", ["--cli-connect-timeout", "30",
    "--cli-read-timeout", "330", "--region", required("AWS_REGION"), ...args], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`aws ${args[0]} failed with ${result.status}`);
  return result.stdout;
}

function awsJson(args) {
  return JSON.parse(aws([...args, "--output", "json"]));
}

function demoSha() {
  const value = required("EACL_DEMO_SHA");
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("EACL_DEMO_SHA is invalid");
  return value;
}

function eaclSha() {
  const lock = JSON.parse(spawnSync("git", ["show", `${demoSha()}:dependencies/eacl-core.lock.json`],
    { cwd: root, encoding: "utf8" }).stdout);
  if (!/^[0-9a-f]{40}$/.test(lock.sha)) throw new Error("locked EACL SHA is invalid");
  return lock.sha;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".map")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}
