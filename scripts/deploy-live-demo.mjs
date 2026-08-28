import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import baseRegistry from "../registry/profile-registry.v1.json" with { type: "json" };
import profileDefinitions from "../packages/contracts/profiles.v1.json" with { type: "json" };
import { createProfilePublication } from "../packages/explorer-state/src/profile-publication.mjs";
import { summarizeDemoSmoke, validateDemoSmokeEnvelope } from "./lib/demo-smoke-result.mjs";

const root = path.resolve(import.meta.dirname, "..");
const target = process.argv[2];
const profiles = {
  "datahike-s3": {
    artifact: "dist/datahike-s3/function.jar",
    functionName: "eacl-demo-datahike-s3-live",
    memorySize: 1024,
    snapStart: true
  },
  "datahike-dynamodb": {
    artifact: "dist/datahike-dynamodb/function.jar",
    functionName: "eacl-demo-datahike-dynamodb-live",
    memorySize: 1024,
    snapStart: true
  },
  "datomic-dynamodb": {
    artifact: "dist/datomic-dynamodb/function.jar",
    functionName: "eacl-demo-datomic-dynamodb-live",
    memorySize: 1024,
    snapStart: false
  },
  "datomic-dynamodb-large": {
    artifact: "dist/datomic-dynamodb/function.jar",
    functionName: "eacl-demo-datomic-dynamodb-large",
    memorySize: 4096,
    snapStart: false,
    profileId: "datomic-dynamodb",
    apiOrigin: "https://7um6u6hb6wq6yfl46ukjkxcpuy0gexer.lambda-url.us-east-1.on.aws",
    publishRegistry: false
  },
  "datalevin-memory": {
    artifact: "dist/datalevin-memory/function.jar",
    functionName: "eacl-demo-datalevin-memory-live",
    memorySize: 1024,
    snapStart: true
  }
};

if (target === "static") await deployStatic();
else if (target === "datomic-dynamodb") await deployDatomicPlatforms();
else if (profiles[target]) await deployProfile(profiles[target].profileId ?? target, profiles[target], target);
else throw new Error(`target must be static or one of ${Object.keys(profiles).join(", ")}`);

async function deployDatomicPlatforms() {
  // Comparisons must be ready before the primary deployment publishes the new
  // registry identity. Otherwise the explorer would advertise stale targets
  // or briefly accept unlike artifacts as a valid performance comparison.
  const comparison = await deployProfile(
    "datomic-dynamodb",
    profiles["datomic-dynamodb-large"],
    "datomic-dynamodb-large"
  );
  await deployDatomicEc2(comparison);
  await deployProfile("datomic-dynamodb", profiles["datomic-dynamodb"], "datomic-dynamodb");
}

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
  const runtimePath = manifest.entries.datascriptRuntime;
  const runtime = manifest.files.find((file) => file.path === runtimePath);
  if (!runtime) throw new Error("DataScript runtime is absent from the static manifest");
  await publishProfile({
    profileId: "datascript-browser-memory",
    artifactKind: "static",
    artifactSha: runtime.sha256,
    artifactVersion: runtime.path,
    dataManifestSha: "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a",
    evidence: runtime.sha256
  });
  process.stdout.write(`deployed static ${demoSha()}\n`);
}

async function deployProfile(profileId, profile, targetId = profileId) {
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
      "--environment", `file://${environmentFile}`,
      "--memory-size", String(profile.memorySize),
      "--snap-start", `ApplyOn=${profile.snapStart ? "PublishedVersions" : "None"}`];
    aws(configuration);
    aws(["lambda", "wait", "function-updated-v2", "--function-name", profile.functionName]);
    deleteReservedConcurrency(profile.functionName);
    assertMutableConfiguration(profile);
    const update = awsJson([
      "lambda", "update-function-code", "--function-name", profile.functionName,
      "--s3-bucket", artifactBucket, "--s3-key", key,
      "--s3-object-version", uploaded.VersionId, "--publish"
    ]);
    if (!/^[1-9][0-9]*$/.test(update.Version)) throw new Error("Lambda did not publish a version");
    aws(["lambda", "wait", "function-updated-v2", "--function-name", profile.functionName]);
    if (profile.snapStart) {
      waitForPublishedVersion(profile.functionName, update.Version);
      const published = awsJson(["lambda", "get-function-configuration",
        "--function-name", profile.functionName, "--qualifier", update.Version]);
      if (published.SnapStart?.ApplyOn !== "PublishedVersions" ||
          published.SnapStart?.OptimizationStatus !== "On") {
        throw new Error(`${profileId} SnapStart version is not optimized`);
      }
    }
    const publishedConfiguration = awsJson(["lambda", "get-function-configuration",
      "--function-name", profile.functionName, "--qualifier", update.Version]);
    if (publishedConfiguration.MemorySize !== profile.memorySize ||
        publishedConfiguration.SnapStart?.ApplyOn !==
          (profile.snapStart ? "PublishedVersions" : "None")) {
      throw new Error(`${profileId} published configuration violates the production runtime policy`);
    }
    const priorAlias = awsJson(["lambda", "get-alias", "--function-name",
      profile.functionName, "--name", "candidate"]);
    const smoke = await smokeProfile(profileId, profile.functionName, temporary, {
      profileId,
      demoSha: demoSha(),
      eaclSha: eaclSha(),
      artifactSha256: artifactSha,
      deploymentId
    }, { qualifier: update.Version, snapStart: profile.snapStart });
    const promoted = awsJson(["lambda", "update-alias", "--function-name",
      profile.functionName, "--name", "candidate",
      "--function-version", update.Version,
      "--description", `demos:${demoSha()}:${artifactSha}`,
      "--revision-id", priorAlias.RevisionId]);
    try {
      await smokeFunctionUrl(profileId, profile.apiOrigin ?? definitionFor(profileId).apiOrigin,
        expectedIdentityFor(profileId, artifactSha, deploymentId));
      if (profile.publishRegistry !== false) {
        await publishProfile({
          profileId,
          artifactKind: "lambda-version",
          artifactSha,
          artifactVersion: update.Version,
          dataManifestSha: smoke.dataManifestSha,
          evidence: createHash("sha256").update(smoke.evidence).digest("hex")
        });
      }
    } catch (error) {
      rollbackAlias(profile.functionName, promoted, priorAlias);
      throw error;
    }
    process.stdout.write(`deployed ${targetId} version ${update.Version} sha256:${artifactSha}\n`);
    return {
      artifactKey: key,
      artifactSha256: artifactSha,
      artifactVersion: uploaded.VersionId,
      deploymentId
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function deployDatomicEc2(release) {
  const instanceId = required("DATOMIC_DYNAMODB_EC2_INSTANCE_ID");
  if (!/^i-[0-9a-f]{8,17}$/u.test(instanceId)) {
    throw new Error("DATOMIC_DYNAMODB_EC2_INSTANCE_ID is invalid");
  }
  const bucket = required("ARTIFACT_BUCKET");
  const region = required("AWS_REGION");
  const script = [
    "set -euo pipefail",
    "install -d -m 0755 /opt/eacl-demo",
    `aws s3api get-object --region ${shellQuote(region)} --bucket ${shellQuote(bucket)} --key ${shellQuote(release.artifactKey)} --version-id ${shellQuote(release.artifactVersion)} /opt/eacl-demo/function.jar.next`,
    `echo ${shellQuote(`${release.artifactSha256}  /opt/eacl-demo/function.jar.next`)} | sha256sum --check --strict`,
    `sed -e ${shellQuote(`s|^EACL_ARTIFACT_SHA256=.*|EACL_ARTIFACT_SHA256=${release.artifactSha256}|`)} -e ${shellQuote(`s|^EACL_CORE_SHA=.*|EACL_CORE_SHA=${eaclSha()}|`)} -e ${shellQuote(`s|^EACL_DEMO_SHA=.*|EACL_DEMO_SHA=${demoSha()}|`)} -e ${shellQuote(`s|^EACL_DEPLOYMENT_ID=.*|EACL_DEPLOYMENT_ID=${release.deploymentId}|`)} /etc/eacl-demo-datomic.env > /etc/eacl-demo-datomic.env.next`,
    `test "$(grep -Ec ${shellQuote("^(EACL_ARTIFACT_SHA256|EACL_CORE_SHA|EACL_DEMO_SHA|EACL_DEPLOYMENT_ID)=") } /etc/eacl-demo-datomic.env.next)" -eq 4`,
    "install -m 0600 /etc/eacl-demo-datomic.env.next /etc/eacl-demo-datomic.env",
    "install -m 0644 /opt/eacl-demo/function.jar.next /opt/eacl-demo/function.jar",
    "systemctl restart eacl-demo-datomic.service",
    "for attempt in $(seq 1 180); do curl --fail --silent -H 'x-eacl-request-id: ec2-release-health' http://127.0.0.1:8080/health >/dev/null && exit 0; sleep 2; done",
    "systemctl status eacl-demo-datomic.service --no-pager",
    "exit 1"
  ].join("\n");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-demo-ec2-release-"));
  try {
    const parametersFile = path.join(temporary, "parameters.json");
    await writeFile(parametersFile, `${JSON.stringify({ commands: [`bash -ceu ${shellQuote(script)}`] })}\n`, { mode: 0o600 });
    const response = awsJson([
      "ssm", "send-command",
      "--document-name", "AWS-RunShellScript",
      "--instance-ids", instanceId,
      "--timeout-seconds", "900",
      "--comment", `EACL ${demoSha().slice(0, 12)} ${release.artifactSha256.slice(0, 12)}`,
      "--parameters", `file://${parametersFile}`
    ]);
    const commandId = response.Command?.CommandId;
    if (!/^[0-9a-f-]{36}$/u.test(commandId ?? "")) {
      throw new Error("SSM did not accept the Datomic EC2 release command");
    }
    await smokeFunctionUrl(
      "datomic-dynamodb",
      "https://datomic.demo.eacl.dev",
      expectedIdentityFor("datomic-dynamodb", release.artifactSha256, release.deploymentId),
      { attempts: 30 }
    );
    process.stdout.write(`deployed datomic-dynamodb-ec2 command ${commandId} sha256:${release.artifactSha256}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function smokeProfile(profileId, functionName, temporary, expectedIdentity,
  { qualifier, snapStart }) {
  const health = await invokeProfile({ profileId, functionName, temporary,
    qualifier, operation: "health", method: "GET", input: null });
  assertHealthy(profileId, health);
  process.stdout.write(`${profileId} version ${qualifier} ${snapStart ? "restore" : "cold"} health ${health.wallMs}ms\n`);
  const bootstrap = await invokeProfile({ profileId, functionName, temporary,
    qualifier, operation: "bootstrap", method: "GET", input: null });
  if (bootstrap.statusCode !== 200 || !("data" in bootstrap.envelope) ||
      "error" in bootstrap.envelope ||
      bootstrap.envelope.data?.identity?.profileId !== profileId ||
      bootstrap.envelope.data?.runtime?.snapStart !==
        (snapStart ? "enabled" : "disabled")) {
    throw new Error(`${profileId} bootstrap smoke failed`);
  }
  const decisions = [];
  for (const [subjectId, expected] of [["user-1", true], ["user-2", false]]) {
    const response = await invokeProfile({ profileId, functionName, temporary,
      qualifier,
      operation: "check-permission", method: "POST",
      input: { subjectType: "user", subjectId, resourceType: "account",
        resourceId: "account-0", permission: "admin" } });
    if (response.statusCode !== 200 || !("data" in response.envelope) ||
        "error" in response.envelope ||
        response.envelope.data?.allowed !== expected) {
      process.stderr.write(
        `authorization smoke failed: ${JSON.stringify({
          profileId,
          qualifier,
          expectedAllowed: expected,
          statusCode: response.statusCode,
          actualAllowed: response.envelope.data?.allowed ?? null,
          errorCode: response.envelope.error?.code ?? null,
          operation: response.envelope.meta?.operation ?? null,
          wallMs: response.wallMs
        })}\n`
      );
      throw new Error(`${profileId} ${expected ? "allow" : "deny"} smoke failed`);
    }
    decisions.push(response);
  }
  const mutation = await invokeProfile({ profileId, functionName, temporary,
    qualifier,
    operation: "seed", method: "POST", input: {} });
  if (mutation.statusCode !== 404 || !("error" in mutation.envelope) ||
      "data" in mutation.envelope ||
      mutation.envelope.error?.code !== "route-not-found") {
    throw new Error(`${profileId} mutation denial smoke failed`);
  }
  return summarizeDemoSmoke({ profileId, expectedIdentity, health, bootstrap, decisions, mutation });
}

async function invokeProfile({ profileId, functionName, temporary, qualifier,
  operation, method, input }) {
  const eventFile = path.join(temporary, "health-event.json");
  const outputFile = path.join(temporary, "health-response.json");
  await writeFile(eventFile, JSON.stringify({
    version: "2.0", routeKey: "$default",
    rawPath: `/${operation}`, rawQueryString: "",
    headers: input === null ? {} : { "content-type": "application/json" },
    requestContext: { requestId: `ci-${operation}-${demoSha().slice(0, 12)}`,
      http: { method } }, isBase64Encoded: false,
    body: input === null ? null : JSON.stringify(input)
  }));
  const started = Date.now();
  aws(["lambda", "invoke", "--function-name", `${functionName}:${qualifier}`,
       "--cli-binary-format", "raw-in-base64-out", "--payload", `fileb://${eventFile}`,
       outputFile]);
  const response = JSON.parse(await readFile(outputFile, "utf8"));
  return { statusCode: response.statusCode,
    envelope: validateDemoSmokeEnvelope(JSON.parse(response.body)),
    wallMs: Date.now() - started };
}

async function smokeFunctionUrl(profileId, origin, expectedIdentity, { attempts = 15 } = {}) {
  const url = new URL("/health", origin);
  let observed = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json", origin: "https://demo.eacl.dev",
          "x-eacl-request-id": `ci-function-url-${demoSha().slice(0, 12)}-${attempt}` },
        redirect: "manual",
        signal: controller.signal
      });
      const text = await response.text();
      const envelope = validateDemoSmokeEnvelope(JSON.parse(text));
      observed = { status: response.status, identity: envelope.data?.identity ?? null };
      if (response.status === 200 && response.headers.get("access-control-allow-origin") ===
          "https://demo.eacl.dev" && response.headers.get("content-type")?.startsWith("application/json") &&
          envelope.data?.ready === true && envelope.data?.identity?.profileId === profileId &&
          envelope.data?.identity?.demoSha === expectedIdentity.demoSha &&
          envelope.data?.identity?.eaclSha === expectedIdentity.eaclSha &&
          envelope.data?.identity?.artifactSha256 === expectedIdentity.artifactSha256 &&
          envelope.data?.identity?.deploymentId === expectedIdentity.deploymentId) {
        return;
      }
    } catch (error) {
      observed = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${profileId} public origin smoke failed after deployment propagation: ${JSON.stringify(observed)}`);
}

function rollbackAlias(functionName, promoted, prior) {
  aws(["lambda", "update-alias", "--function-name", functionName,
       "--name", "candidate", "--function-version", prior.FunctionVersion,
       "--description", prior.Description || `restored ${prior.FunctionVersion}`,
       "--revision-id", promoted.RevisionId]);
}

function definitionFor(profileId) {
  const definition = profileDefinitions.profiles.find((candidate) => candidate.id === profileId);
  if (!definition?.apiOrigin) throw new Error(`${profileId} has no direct Function URL origin`);
  return definition;
}

function expectedIdentityFor(profileId, artifactSha256, deploymentId) {
  return { profileId, demoSha: demoSha(), eaclSha: eaclSha(), artifactSha256,
    deploymentId };
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
  const output = aws([...args, "--output", "json"]).trim();
  return output === "" ? {} : JSON.parse(output);
}

function deleteReservedConcurrency(functionName) {
  const current = awsJson(["lambda", "get-function-concurrency",
    "--function-name", functionName]);
  if (current.ReservedConcurrentExecutions !== undefined) {
    aws(["lambda", "delete-function-concurrency", "--function-name", functionName]);
  }
  const observed = awsJson(["lambda", "get-function-concurrency",
    "--function-name", functionName]);
  if (observed.ReservedConcurrentExecutions !== undefined) {
    throw new Error(`${functionName} still has reserved concurrency`);
  }
}

function assertMutableConfiguration(profile) {
  const configuration = awsJson(["lambda", "get-function-configuration",
    "--function-name", profile.functionName]);
  if (configuration.MemorySize !== profile.memorySize ||
      configuration.SnapStart?.ApplyOn !==
        (profile.snapStart ? "PublishedVersions" : "None")) {
    throw new Error(`${profile.functionName} mutable configuration violates the production runtime policy`);
  }
}

function waitForPublishedVersion(functionName, version) {
  try {
    aws(["lambda", "wait", "published-version-active", "--function-name",
         functionName, "--qualifier", version]);
  } catch (waitError) {
    // The waiter reports only that `State` became `Failed`. Preserve the
    // Lambda-owned, non-secret failure classification in Actions output so a
    // failed SnapStart image can be diagnosed without console access.
    let diagnostic = {};
    try {
      const configuration = awsJson(["lambda", "get-function-configuration",
        "--function-name", functionName, "--qualifier", version]);
      diagnostic = {
        functionName,
        version,
        state: configuration.State ?? null,
        stateReasonCode: configuration.StateReasonCode ?? null,
        stateReason: configuration.StateReason ?? null,
        lastUpdateStatus: configuration.LastUpdateStatus ?? null,
        lastUpdateStatusReasonCode: configuration.LastUpdateStatusReasonCode ?? null,
        lastUpdateStatusReason: configuration.LastUpdateStatusReason ?? null,
        snapStart: configuration.SnapStart ?? null
      };
    } catch (diagnosticError) {
      diagnostic = {
        functionName,
        version,
        diagnosticError: diagnosticError instanceof Error
          ? diagnosticError.message
          : String(diagnosticError)
      };
    }
    process.stderr.write(`published version failed: ${JSON.stringify(diagnostic)}\n`);
    throw waitError;
  }
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".map")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}
