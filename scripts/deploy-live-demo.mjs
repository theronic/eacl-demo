import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import baseRegistry from "../registry/profile-registry.v1.json" with { type: "json" };
import profileDefinitions from "../packages/contracts/profiles.v1.json" with { type: "json" };
import { createProfilePublication } from "../packages/explorer-state/src/profile-publication.mjs";

const root = path.resolve(import.meta.dirname, "..");
const target = process.argv[2];
const profiles = {
  "datahike-s3": {
    artifact: "dist/datahike-s3/function.jar",
    functionName: "eacl-demo-datahike-s3-live"
  },
  "datomic-dynamodb": {
    artifact: "dist/datomic-dynamodb/function.jar",
    functionName: "eacl-demo-datomic-dynamodb-live"
  },
  "datalevin-memory": {
    artifact: "dist/datalevin-memory/function.jar",
    functionName: "eacl-demo-datalevin-memory-live"
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
  const variables = { ...(current.Environment?.Variables ?? {}),
    EACL_ARTIFACT_SHA256: artifactSha,
    EACL_CORE_SHA: eaclSha(),
    EACL_DEMO_SHA: demoSha(),
    EACL_DEPLOYMENT_ID: `demos:${demoSha()}:${profileId}`
  };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-demo-deploy-"));
  try {
    const environmentFile = path.join(temporary, "environment.json");
    await writeFile(environmentFile, `${JSON.stringify({ Variables: variables })}\n`, { mode: 0o600 });
    aws(["lambda", "update-function-configuration", "--function-name", profile.functionName,
         "--environment", `file://${environmentFile}`]);
    aws(["lambda", "wait", "function-updated-v2", "--function-name", profile.functionName]);
    const update = awsJson([
      "lambda", "update-function-code", "--function-name", profile.functionName,
      "--s3-bucket", artifactBucket, "--s3-key", key,
      "--s3-object-version", uploaded.VersionId, "--publish"
    ]);
    if (!/^[1-9][0-9]*$/.test(update.Version)) throw new Error("Lambda did not publish a version");
    aws(["lambda", "wait", "function-updated-v2", "--function-name", profile.functionName]);
    aws(["lambda", "update-alias", "--function-name", profile.functionName,
         "--name", "candidate", "--function-version", update.Version,
         "--description", `demos:${demoSha()}:${artifactSha}`]);
    const smoke = await smokeProfile(profileId, profile.functionName, temporary);
    await publishProfile({
      profileId,
      artifactKind: "lambda-version",
      artifactSha,
      artifactVersion: update.Version,
      dataManifestSha: profileId === "datahike-s3"
        ? "a97c5b2ecac32012bdd37963348d840c5d405ad2858c0136eb17006ba97167b8"
        : "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a",
      evidence: createHash("sha256").update(smoke).digest("hex")
    });
    process.stdout.write(`deployed ${profileId} version ${update.Version} sha256:${artifactSha}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function smokeProfile(profileId, functionName, temporary) {
  const eventFile = path.join(temporary, "health-event.json");
  const outputFile = path.join(temporary, "health-response.json");
  await writeFile(eventFile, JSON.stringify({
    version: "2.0", routeKey: "$default",
    rawPath: `/api/v1/${profileId}/health`, rawQueryString: "",
    headers: {}, requestContext: { requestId: `ci-${demoSha().slice(0, 16)}`,
      http: { method: "GET" } }, isBase64Encoded: false, body: null
  }));
  aws(["lambda", "invoke", "--function-name", `${functionName}:candidate`,
       "--cli-binary-format", "raw-in-base64-out", "--payload", `fileb://${eventFile}`,
       outputFile]);
  const response = JSON.parse(await readFile(outputFile, "utf8"));
  const body = JSON.parse(response.body);
  if (response.statusCode !== 200 || body.ok !== true || body.data?.ready !== true ||
      body.data?.identity?.demoSha !== demoSha() ||
      body.data?.identity?.eaclSha !== eaclSha()) {
    throw new Error(`${profileId} health smoke failed`);
  }
  return JSON.stringify(response);
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
