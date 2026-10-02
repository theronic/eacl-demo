import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, constants, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { smokeFunctionUrl } from "./lib/public-readiness.mjs";
import { releaseCommandWatch } from "./lib/release-command-result.mjs";
import { storageV8Environment } from "./lib/storage-v8.mjs";

const [deploySource, datomicTemplate, datalevinTemplate] = await Promise.all([
  readFile(new URL("./deploy-live-demo.mjs", import.meta.url), "utf8"),
  readFile(new URL("../infra/profiles/datomic-dynamodb-ec2.yaml", import.meta.url), "utf8"),
  readFile(new URL("../infra/profiles/datalevin-memory-ec2.yaml", import.meta.url), "utf8")
]);

const demoSha = "d".repeat(40);
const eaclSha = "e".repeat(40);
const previousDemoSha = "a".repeat(40);
const previousEaclSha = "b".repeat(40);
const cursorKey = "c".repeat(64);
const bucket = "eacl-demo-artifacts";
const region = "us-east-1";
const instanceId = "i-0123456789abcdef0";
const commandId = "0f1e2d3c-4b5a-4697-8877-665544332211";
const deployRoot = "/checkout";
const epoch = 1_800_000_000;
// GetCommandInvocation returns only this much of what a command prints.
const ssmStandardOutputCharacters = 24_000;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// A fake jar describes the service it would run: its name, then how many
// seconds after a restart it starts answering /health. `never` is a jar that
// cannot start, `once` one that answers until it is next restarted.
const jar = (name, startup) => `${name}\n${startup}\n`;
const previousJar = jar("release-1", 20);
const brokenJar = jar("release-2", "never");

const hosts = [
  {
    profile: "datomic-dynamodb",
    deploy: "deployDatomicEc2",
    instanceVariable: "DATOMIC_DYNAMODB_EC2_INSTANCE_ID",
    template: datomicTemplate,
    jar: "/opt/eacl-demo/function.jar",
    environmentFile: "/etc/eacl-demo-datomic.env",
    unit: "eacl-demo-datomic.service",
    logFile: "/var/log/eacl-demo/datomic.log",
    port: 8080,
    // The unit sets no TimeoutStopSec, so systemd waits its default 90 s.
    stopSeconds: 90,
    environment: ({ artifactSha256, core, demo, table, workers, concurrency }) => [
      `AWS_REGION=${region}`,
      "AWS_LAMBDA_FUNCTION_NAME=eacl-demo-datomic-dynamodb-ec2",
      `EACL_ARTIFACT_SHA256=${artifactSha256}`,
      `EACL_CORE_SHA=${core}`,
      `EACL_CURSOR_KEY=${cursorKey}`,
      "EACL_DATOMIC_DATABASE=eacl-demo",
      `EACL_DATOMIC_TABLE=${table}`,
      `EACL_DEMO_SHA=${demo}`,
      `EACL_DEPLOYMENT_ID=production:${demo}:datomic-dynamodb`,
      "EACL_HTTP_PORT=8080",
      ...workers,
      `EACL_MAXIMUM_CONCURRENCY=${concurrency}`,
      "EACL_RUNTIME_EXECUTION=ec2",
      "EACL_RUNTIME_MEMORY_MIB=2048",
      "EACL_JAVA_OPTS=-Xms1024m -Xmx1024m -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError -Ddatomic.objectCacheMax=576m"
    ],
    installed: { table: "eacl-demo-datomic-fixture-v1-green", workers: ["EACL_HTTP_WORKERS=4"], concurrency: 1 },
    released: { table: storageV8Environment("datomic-dynamodb").EACL_DATOMIC_TABLE, workers: [], concurrency: 4 }
  },
  {
    profile: "datalevin-memory",
    deploy: "deployDatalevinEc2",
    instanceVariable: "DATALEVIN_EC2_INSTANCE_ID",
    template: datalevinTemplate,
    jar: "/opt/eacl-demo/datalevin.jar",
    environmentFile: "/etc/eacl-demo-datalevin.env",
    unit: "eacl-demo-datalevin.service",
    logFile: "/var/log/eacl-demo/datalevin.log",
    port: 8081,
    stopSeconds: 15,
    environment: ({ artifactSha256, core, demo, concurrency }) => [
      "AWS_LAMBDA_FUNCTION_NAME=eacl-demo-datalevin-memory-ec2",
      `EACL_ARTIFACT_SHA256=${artifactSha256}`,
      `EACL_CORE_SHA=${core}`,
      `EACL_CURSOR_KEY=${cursorKey}`,
      `EACL_DEMO_SHA=${demo}`,
      `EACL_DEPLOYMENT_ID=production:${demo}:datalevin-memory`,
      "EACL_DATALEVIN_DIRECTORY=/var/lib/eacl-demo/datalevin",
      "EACL_HTTP_PORT=8081",
      "EACL_HTTP_WORKERS=1",
      `EACL_MAXIMUM_CONCURRENCY=${concurrency}`,
      "EACL_RUNTIME_EXECUTION=ec2",
      "EACL_RUNTIME_MEMORY_MIB=1024"
    ],
    installed: { concurrency: 2 },
    released: { concurrency: 1 }
  }
];

const installedEnvironment = (host, artifact = previousJar) => `${host.environment({
  ...host.installed, artifactSha256: sha256(artifact), core: previousEaclSha, demo: previousDemoSha
}).join("\n")}\n`;
const releasedEnvironment = (host, artifact) => `${host.environment({
  ...host.released, artifactSha256: sha256(artifact), core: eaclSha, demo: demoSha
}).join("\n")}\n`;

// deploy-live-demo.mjs dispatches on import, so the release functions are
// lifted out of its source and run with stand-ins for AWS and the public
// smokes. What they hand to `aws ssm send-command` is the command under test.
function lifted(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(.*?^\\}$`, "msu").exec(deploySource);
  assert.ok(match, `${name} is no longer a top-level function of deploy-live-demo.mjs`);
  return match[0];
}

// `wait` stands in for what follows the send: the wait for the public origin
// and the AWS CLI that reads the command's result during it. Without it the
// origin shows the release at once and nothing is read.
function deployment(host, artifact, wait = {}) {
  const release = {
    artifactKey: `artifacts/${host.profile}/${demoSha}/${sha256(artifact)}.jar`,
    artifactSha256: sha256(artifact),
    artifactVersion: "object-version-2",
    deploymentId: `production:${demoSha}:${host.profile}`
  };
  const sent = [];
  const written = [];
  const scope = {
    mkdtemp, writeFile, rm, os, path,
    root: deployRoot,
    process: {
      env: wait.environment ?? {},
      stdout: { write: (text, flushed) => {
        written.push(text);
        flushed?.();
      } }
    },
    storageV8Environment,
    required: (name) => ({ ARTIFACT_BUCKET: bucket, AWS_REGION: region })[name] ??
      assert.fail(`unexpected required(${name})`),
    ec2InstanceId: (variable) => {
      assert.equal(variable, host.instanceVariable);
      return instanceId;
    },
    demoSha: () => demoSha,
    eaclSha: () => eaclSha,
    expectedIdentityFor: (profileId, artifactSha256, deploymentId) =>
      ({ profileId, demoSha, eaclSha, artifactSha256, deploymentId }),
    smokeFunctionUrl: wait.smokeFunctionUrl ?? (async () => {}),
    smokeDatomicHistoricalUrl: async () => {},
    smokeDatomicAdmissionQueueUrl: async () => {},
    releaseCommandWatch: wait.releaseCommandWatch ?? releaseCommandWatch,
    execFile: wait.execFile ?? (() => assert.fail("the job read a result it had no reason to read")),
    awsJson: async (args) => {
      const parameters = args[args.indexOf("--parameters") + 1];
      sent.push({ args, parameters: JSON.parse(await readFile(new URL(parameters), "utf8")) });
      return { Command: { CommandId: commandId } };
    }
  };
  const declarations = [
    "deployDatomicEc2", "deployDatalevinEc2", "ec2ReleaseWatch", "ec2CommandInvocation", "ec2ReleaseScript", "shellQuote"
  ].map(lifted);
  const functions = new Function(...Object.keys(scope),
    `${declarations.join("\n")}\nreturn { deployDatomicEc2, deployDatalevinEc2 };`)(...Object.values(scope));
  return { release, sent, written, done: functions[host.deploy](release) };
}

async function sentCommand(host, artifact) {
  const { release, sent, written, done } = deployment(host, artifact);
  await done;
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].parameters), ["commands"]);
  assert.equal(sent[0].parameters.commands.length, 1);
  return { args: sent[0].args, command: sent[0].parameters.commands[0], release, written };
}

// What the installed AWS CLI writes to stderr when SSM refuses or fails a
// request, as CLI 2.34 prints it and as earlier releases did.
const cliErrors = (code, message) => [
  `\naws: [ERROR]: An error occurred (${code}) when calling the GetCommandInvocation operation: ${message}\n`,
  `\nAn error occurred (${code}) when calling the GetCommandInvocation operation (reached max retries: 2): ${message}\n`
];
const deniedMessage = "User: arn:aws:sts::123456789012:assumed-role/example-deploy/example-session is not authorized to perform: ssm:GetCommandInvocation on resource: arn:aws:ssm:us-east-1:123456789012:* because no identity-based policy allows the ssm:GetCommandInvocation action";

// The job's side of a release: the real wait for the public origin and the
// real reading of the command's result, on a clock that only the wait's own
// sleeps move. `origin` says which identity /health serves at a given second
// and `ssm` what the AWS CLI then answers: an invocation, or
// `{ stderr, killed }` for a call that failed.
function waiting({ origin, ssm, environment = {} }) {
  let elapsed = 0;
  const timer = { now: () => elapsed, sleep: async (ms) => { elapsed += ms; } };
  const reads = [];
  return {
    environment,
    reads,
    seconds: () => elapsed / 1_000,
    smokeFunctionUrl: (profileId, url, identity, options) => smokeFunctionUrl(profileId, url, identity, {
      ...options,
      ...timer,
      fetchResponse: async () => new Response(JSON.stringify({
        data: { ready: true, identity: { ...identity, ...origin(elapsed / 1_000) } },
        meta: { revision: "fixture:17", requestId: "ec2-release-test" }
      }), { headers: {
        "content-type": "application/json", "access-control-allow-origin": "https://demo.eacl.dev"
      } })
    }),
    releaseCommandWatch: (options) => releaseCommandWatch({ ...options, now: timer.now }),
    execFile: (file, args, options, callback) => {
      reads.push({ file, args, options, second: elapsed / 1_000 });
      const answer = ssm(elapsed / 1_000);
      if (answer.stderr === undefined) callback(null, `${JSON.stringify(answer, null, 4)}\n`, "");
      else callback(Object.assign(new Error("Command failed: aws"), { code: 254, killed: answer.killed === true }), "", answer.stderr);
    }
  };
}

const invocation = (status, responseCode, standardOutput = "", standardError = "") => ({
  CommandId: commandId, InstanceId: instanceId, Comment: "", DocumentName: "AWS-RunShellScript",
  DocumentVersion: "$DEFAULT", PluginName: "aws:runShellScript", ResponseCode: responseCode,
  ExecutionStartDateTime: "", ExecutionElapsedTime: "", ExecutionEndDateTime: "",
  Status: status, StatusDetails: status, StandardOutputContent: standardOutput, StandardOutputUrl: "",
  StandardErrorContent: standardError, StandardErrorUrl: "",
  CloudWatchOutputConfig: { CloudWatchLogGroupName: "", CloudWatchOutputEnabled: false }
});
// The origin goes on serving, or serves again, the release before this one.
const previousRelease = () => ({
  demoSha: previousDemoSha, eaclSha: previousEaclSha, artifactSha256: sha256(previousJar),
  deploymentId: `production:${previousDemoSha}:previous`
});

// Children get no standard input. A pipe from Node is a socket, and a
// top-level `bash -c` that reads from a socket takes itself for a remote
// shell: it sources bashrc files and skips BASH_ENV.
function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const output = { stdout: "", stderr: "" };
    for (const stream of ["stdout", "stderr"]) {
      child[stream].setEncoding("utf8");
      child[stream].on("data", (text) => { output[stream] += text; });
    }
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, ...output }));
  });
}

async function onPath(name) {
  for (const directory of process.env.PATH.split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

// The command gets a PATH that holds these host tools and nothing else, so a
// release that reached for the real aws, systemctl, curl, sleep or date would
// fail here instead of running it. `cp` is left out on purpose: the swap and
// the restore have to work on a full disk.
async function toolDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eacl-ec2-release-tools-"));
  assert.match(directory, /^[\w/.+-]+$/u, "the temporary directory must not need shell quoting");
  for (const name of ["bash", "install", "chmod", "ln", "mv", "rm", "sed", "grep", "tail"]) {
    const tool = await onPath(name);
    assert.ok(tool, `${name} is not on PATH`);
    await symlink(tool, path.join(directory, name));
  }
  // The hosts have GNU sha256sum. macOS ships one without --check --strict;
  // its shasum takes the same flags and reads the same digest lines.
  const probe = path.join(directory, "probe");
  await writeFile(probe, "probe");
  const checks = async (tool) => tool !== null && (await run("/bin/sh",
    ["-c", `echo '${sha256("probe")}  ${probe}' | ${tool} --check --strict`])).status === 0;
  const sha256sum = await onPath("sha256sum");
  if (await checks(sha256sum)) {
    await symlink(sha256sum, path.join(directory, "sha256sum"));
  } else {
    const shasum = await onPath("shasum");
    assert.ok(await checks(shasum === null ? null : `${shasum} -a 256`),
      "neither sha256sum nor shasum can check a digest here");
    await writeFile(path.join(directory, "sha256sum"), `#!/bin/sh\nexec ${shasum} -a 256 "$@"\n`);
    await chmod(path.join(directory, "sha256sum"), 0o755);
  }
  await rm(probe);
  return directory;
}

const skip = process.platform === "win32" ? "the release command needs a POSIX shell" : false;
const tools = skip ? null : await toolDirectory();
after(async () => {
  if (tools !== null) await rm(tools, { recursive: true, force: true });
});

// Stand-ins for the commands that would reach AWS, systemd, the service and
// the clock. The command's own bash reads them through BASH_ENV before it
// runs, so each is a function: a poll costs no process and a six-minute wait
// takes no real time. `sleep` and `date` share one clock, which a slow stop,
// a slow download or a hung request also moves.
function standIns({ state, jar: liveJar, environmentFile, logFile, unit, hang, stopSeconds, downloadSeconds, restartFails, missedRequests }) {
  const running = (name) => `$(sed -n 's/^${name}=//p' ${state}/running.env)`;
  return [
    "unexpected() {",
    `  echo "unexpected $*" >&2`,
    `  echo "$*" >> ${state}/unexpected`,
    "  return 64",
    "}",
    // Whether the running service answers /health at the given time.
    "service_answers() {",
    "  local name startup restarted",
    `  { read -r name; read -r startup; } < ${state}/running.jar`,
    `  read -r restarted < ${state}/restarted`,
    `  case "$startup" in`,
    "    never) return 1 ;;",
    `    once) [ "$restarted" -lt ${epoch} ] ;;`,
    `    *) [ "$1" -ge $((restarted + startup)) ] ;;`,
    "  esac",
    "}",
    "date() {",
    `  [ "$*" = +%s ] || { unexpected date "$@"; return 64; }`,
    "  local clock",
    `  read -r clock < ${state}/clock`,
    `  echo "$clock"`,
    "}",
    "sleep() {",
    "  local clock",
    `  read -r clock < ${state}/clock`,
    `  echo $((clock + $1)) > ${state}/clock`,
    "}",
    "aws() {",
    `  echo "aws $*" >> ${state}/calls`,
    `  [ "$1 $2" = "s3api get-object" ] || { unexpected aws "$@"; return 64; }`,
    "  local clock",
    `  read -r clock < ${state}/clock`,
    `  echo $((clock + ${downloadSeconds})) > ${state}/clock`,
    `  echo "$(<${state}/artifact)" > "\${!#}"`,
    `  echo '{"VersionId": "object-version-2"}'`,
    "}",
    "systemctl() {",
    `  echo "systemctl $*" >> ${state}/calls`,
    `  [ "\${2:-}" = ${unit} ] || { unexpected systemctl "$@"; return 64; }`,
    "  local clock name startup",
    `  read -r clock < ${state}/clock`,
    `  case "$1" in`,
    "    restart)",
    `      { read -r name; read -r startup; } < ${liveJar}`,
    `      echo "$clock $name" >> ${state}/restarts`,
    `      if [ "$name" = "${restartFails}" ]; then echo "Job for ${unit} failed." >&2; return 1; fi`,
    // Stopping the old process takes time before the new one is started.
    `      clock=$((clock + ${stopSeconds}))`,
    `      echo "$clock" > ${state}/clock`,
    `      echo "$clock" > ${state}/restarted`,
    `      echo "$(<${liveJar})" > ${state}/running.jar`,
    `      echo "$(<${environmentFile})" > ${state}/running.env`,
    `      if service_answers $((clock + 1000000)); then`,
    `        echo "$name: reader listening" >> ${logFile}`,
    "      else",
    `        echo "$name: Execution error (ExceptionInfo) :datalevin/frozen-attribute-write" >> ${logFile}`,
    "      fi",
    "      ;;",
    "    status)",
    `      [ "\${3:-}" = --no-pager ] || { unexpected systemctl "$@"; return 64; }`,
    `      read -r name < ${state}/running.jar`,
    // About as much text as systemd prints for a unit with a long ExecStart.
    `      echo "CGroup: ${"x".repeat(3000)}"`,
    `      if service_answers "$clock"; then echo "${unit}: active (running) $name"; return 0; fi`,
    `      echo "${unit}: activating (auto-restart) $name"`,
    "      return 3",
    "      ;;",
    `    *) unexpected systemctl "$@"; return 64 ;;`,
    "  esac",
    "}",
    "curl() {",
    `  echo "curl $*" >> ${state}/calls`,
    "  local clock argument limit= option= missed",
    // A busy service answers its first requests with an error.
    `  read -r missed < ${state}/missed`,
    `  if [ "$missed" -lt ${missedRequests} ]; then echo $((missed + 1)) > ${state}/missed; return 22; fi`,
    `  for argument; do if [ "$option" = --max-time ]; then limit=$argument; fi; option=$argument; done`,
    `  read -r clock < ${state}/clock`,
    // The service reports the identity it was started with, as /health does.
    `  if service_answers "$clock"; then`,
    `    echo "{\\"data\\":{\\"ready\\":true,\\"identity\\":{\\"artifactSha256\\":\\"${running("EACL_ARTIFACT_SHA256")}\\",\\"demoSha\\":\\"${running("EACL_DEMO_SHA")}\\"}}}"`,
    "    return 0",
    "  fi",
    // A service that accepts the connection and never answers holds the
    // request until curl gives up, which without --max-time is never.
    ...(hang ? [`  echo $((clock + \${limit:-1000000})) > ${state}/clock`, "  return 28"] : ["  return 7"]),
    "}"
  ].join("\n");
}

// Runs the lifted command the way the SSM agent does, as a line of an sh
// script, against a host that exists only under a temporary directory.
async function release(t, host, {
  artifact,
  installed = previousJar,
  environment = installed === null ? installedEnvironment(host) : installedEnvironment(host, installed),
  // The process that is serving before the release, and the pair already kept.
  running = { jar: installed, environment },
  kept = null,
  // A staged environment file that an earlier command left world-readable.
  staged = false,
  delivered = artifact,
  log = `${"earlier line\n".repeat(60)}release-1: reader listening\n`,
  hang = false,
  stopSeconds = 0,
  downloadSeconds = 0,
  restartFails = "no release",
  missedRequests = 0
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "eacl-ec2-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.match(root, /^[\w/.+-]+$/u, "the temporary directory must not need shell quoting");
  const at = (file) => `${root}${file}`;
  const state = at("/state");
  for (const directory of ["/state", "/opt/eacl-demo", "/etc/systemd/system", "/var/log/eacl-demo"]) {
    await mkdir(at(directory), { recursive: true });
  }
  await writeFile(at(`/etc/systemd/system/${host.unit}`), "[Service]\n");
  await writeFile(at(host.environmentFile), environment, { mode: 0o600 });
  await writeFile(at(host.logFile), log);
  if (installed !== null) await writeFile(at(host.jar), installed, { mode: 0o644 });
  if (kept === "linked") {
    // An earlier command was cut off after keeping the pair and before the swap.
    await link(at(host.jar), at(`${host.jar}.previous`));
    await link(at(host.environmentFile), at(`${host.environmentFile}.previous`));
  } else if (kept !== null) {
    await writeFile(at(`${host.jar}.previous`), kept.jar, { mode: 0o644 });
    await writeFile(at(`${host.environmentFile}.previous`), kept.environment, { mode: 0o600 });
  }
  if (staged) {
    await writeFile(at(`${host.environmentFile}.next`), "EACL_CURSOR_KEY=left behind\n");
    await chmod(at(`${host.environmentFile}.next`), 0o644);
  }
  await writeFile(`${state}/clock`, `${epoch}\n`);
  await writeFile(`${state}/calls`, "");
  await writeFile(`${state}/restarts`, "");
  await writeFile(`${state}/missed`, "0\n");
  await writeFile(`${state}/artifact`, delivered);
  // The service that is running before the release started long ago.
  await writeFile(`${state}/running.jar`, running.jar ?? jar("nothing", "never"));
  await writeFile(`${state}/running.env`, running.environment);
  await writeFile(`${state}/restarted`, `${epoch - 86_400}\n`);
  await writeFile(at("/stand-ins.sh"), `${standIns({
    state, jar: at(host.jar), environmentFile: at(host.environmentFile), logFile: at(host.logFile),
    unit: host.unit, hang, stopSeconds, downloadSeconds, restartFails, missedRequests
  })}\n`);

  const { command } = await sentCommand(host, artifact);
  await writeFile(at("/_script.sh"), `${command.replace(/\/(?:opt|etc|var)\//gu, (directory) => `${root}${directory}`)}\n`);
  const { status, stdout, stderr } = await run("/bin/sh", ["_script.sh"], {
    cwd: root, env: { PATH: tools, BASH_ENV: at("/stand-ins.sh") }
  });

  const read = async (file) => {
    try {
      return await readFile(at(file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  assert.equal(await read("/state/unexpected"), null, `${stdout}${stderr}`);
  // Nothing the command prints may carry the environment file's cursor key.
  assert.equal(`${stdout}${stderr}`.includes(cursorKey), false, "the command printed the cursor key");
  const lines = async (file) => (await read(`/state/${file}`)).split("\n").filter(Boolean);
  return {
    root, status, stdout, stderr, read,
    mode: async (file) => (await stat(at(file))).mode & 0o777,
    calls: await lines("calls"),
    restarts: (await lines("restarts")).map((line) => {
      const [clock, name] = line.split(" ");
      return { at: Number(clock) - epoch, name };
    }),
    elapsed: Number(await read("/state/clock")) - epoch
  };
}

const restarted = (outcome) => outcome.restarts.map(({ name }) => name);
const started = (outcome, command) => outcome.calls.filter((call) => call.startsWith(`${command} `));

function assertOrdered(text, fragments) {
  let from = 0;
  for (const fragment of fragments) {
    const found = text.indexOf(fragment, from);
    assert.notEqual(found, -1, `${JSON.stringify(fragment)} is missing or out of order in:\n${text}`);
    from = found + fragment.length;
  }
}

async function assertPreviousReleaseInstalled(host, outcome, installed = previousJar) {
  assert.equal(await outcome.read(host.jar), installed);
  assert.equal(await outcome.read(host.environmentFile), installedEnvironment(host, installed));
  assert.equal(await outcome.mode(host.jar), 0o644);
  assert.equal(await outcome.mode(host.environmentFile), 0o600);
}

test("the fake host matches the paths, ports and stop timeouts the templates give the real ones", () => {
  for (const host of hosts) {
    assert.ok(host.template.includes(`EnvironmentFile=${host.environmentFile}`), host.profile);
    assert.ok(host.template.includes(`-cp ${host.jar} clojure.main`), host.profile);
    assert.ok(host.template.includes(`StandardOutput=append:${host.logFile}`), host.profile);
    assert.ok(host.template.includes(`StandardError=append:${host.logFile}`), host.profile);
    assert.ok(host.template.includes(`/etc/systemd/system/${host.unit}`), host.profile);
    assert.match(host.template, new RegExp(`echo ["']EACL_HTTP_PORT=${host.port}["']`, "u"), host.profile);
    assert.match(host.template, new RegExp(`http://127\\.0\\.0\\.1:${host.port}/health`, "u"), host.profile);
  }
  assert.doesNotMatch(datomicTemplate, /TimeoutStopSec/u);
  assert.match(datalevinTemplate, /TimeoutStopSec=15\n/u);
});

test("the job reads a command's result with one bounded AWS CLI call that cannot fail the deployment", async () => {
  const calls = [];
  const read = (answer) => new Function("execFile", "required", "root",
    `${lifted("ec2CommandInvocation")}\nreturn ec2CommandInvocation;`)(
    (file, args, options, callback) => {
      calls.push({ file, args, options });
      answer(callback);
    },
    (name) => ({ AWS_REGION: region })[name] ?? assert.fail(`unexpected required(${name})`),
    deployRoot
  )(commandId, instanceId);
  const failing = (stderr, fields = {}) => (callback) =>
    callback(Object.assign(new Error("Command failed: aws"), { code: 254, killed: false, ...fields }), "", stderr);

  const restored = invocation("Failed", 1, "The previous release is restored and healthy.\n", "failed to run commands: exit status 1");
  assert.deepEqual(await read((callback) => callback(null, `${JSON.stringify(restored, null, 4)}\n`, "")),
    { invocation: restored });
  assert.deepEqual(calls, [{
    file: "aws",
    args: ["--cli-connect-timeout", "5", "--cli-read-timeout", "10", "--region", region,
      "ssm", "get-command-invocation", "--command-id", commandId, "--instance-id", instanceId, "--output", "json"],
    options: { cwd: deployRoot, encoding: "utf8", timeout: 20_000 }
  }]);

  for (const stderr of cliErrors("AccessDeniedException", deniedMessage)) {
    assert.deepEqual(await read(failing(stderr)), { denied: true });
  }
  // Every other failure is one to read past. Only the error code decides,
  // not a message that happens to mention permission.
  for (const [code, message] of [
    ["InvocationDoesNotExist", ""],
    ["InvalidInstanceId", "You don't have permission to access the managed node."],
    ["InternalServerError", "AccessDeniedException from a dependency"],
    ["ThrottlingException", "Rate exceeded"],
    ["ExpiredTokenException", "The security token included in the request is expired"]
  ]) {
    for (const stderr of cliErrors(code, message)) {
      assert.deepEqual(await read(failing(stderr)), { unavailable: code });
    }
  }
  assert.deepEqual(await read(failing("", { code: null, killed: true, signal: "SIGTERM" })),
    { unavailable: "no answer from the AWS CLI" });
  assert.deepEqual(await read(failing("\nUnable to locate credentials. You can configure credentials by running \"aws login\".\n", { code: 253 })),
    { unavailable: "the AWS CLI failed" });
  assert.deepEqual(await read((callback) => callback(null, "", "")), { unavailable: "an answer that is not JSON" });
});

test("the job's report is on its way out of the process before the job goes on to fail", async () => {
  for (const [environment, workflowCommands] of [[{}, false], [{ GITHUB_ACTIONS: "true" }, true], [{ GITHUB_ACTIONS: "1" }, false]]) {
    let options = null;
    const events = [];
    const watch = new Function("releaseCommandWatch", "process", "ec2CommandInvocation",
      `${lifted("ec2ReleaseWatch")}\nreturn ec2ReleaseWatch;`)(
      (given) => {
        options = given;
        return "the watch";
      },
      // A write that takes a callback has not left the process until the
      // callback runs.
      { env: environment, stdout: { write: (text, flushed) => {
        events.push(`writing ${text}`);
        setImmediate(() => {
          events.push("flushed");
          flushed();
        });
      } } },
      (...read) => read
    )("datalevin-memory-ec2", commandId, instanceId);
    assert.equal(watch, "the watch");
    assert.deepEqual(Object.keys(options).sort(), ["label", "readInvocation", "workflowCommands", "write"]);
    assert.equal(options.label, `datalevin-memory-ec2 command ${commandId}`);
    assert.equal(options.workflowCommands, workflowCommands);
    assert.deepEqual(options.readInvocation(), [commandId, instanceId]);
    await options.write("report").then(() => events.push("the job goes on"));
    assert.deepEqual(events, ["writing report", "flushed", "the job goes on"]);
  }
});

for (const host of hosts) {
  describe(`${host.profile} EC2 release command`, { concurrency: true, skip }, () => {
    test("is one bash command for the profile's own instance, named in the job log", async () => {
      const { args, release: sent, command, written } = await sentCommand(host, jar("release-2", 30));
      assert.deepEqual(args.slice(0, 2), ["ssm", "send-command"]);
      for (const [option, value] of [
        ["--document-name", "AWS-RunShellScript"], ["--instance-ids", instanceId], ["--timeout-seconds", "900"]
      ]) assert.equal(args[args.indexOf(option) + 1], value, option);
      assert.match(command, /^bash -ceu 'set -euo pipefail\n/u);
      assert.ok(command.includes(sent.artifactSha256));
      // Nothing is copied on the host, so nothing in the command needs free space
      // beyond the download.
      assert.doesNotMatch(command, /\bcp\b|\binstall -m\b/u);
      assert.match(written[0], new RegExp(`^sent ${host.profile}-ec2 command ${commandId}\\n$`, "u"));
    });

    test("installs a healthy release and keeps the one it replaced", async (t) => {
      const artifact = jar("release-2", 30);
      const outcome = await release(t, host, { artifact });
      assert.equal(outcome.status, 0, outcome.stderr);
      assert.equal(await outcome.read(host.jar), artifact);
      assert.equal(await outcome.read(host.environmentFile), releasedEnvironment(host, artifact));
      assert.equal(await outcome.read("/state/running.env"), releasedEnvironment(host, artifact));
      assert.equal(await outcome.mode(host.jar), 0o644);
      assert.equal(await outcome.mode(host.environmentFile), 0o600);
      assert.equal(await outcome.read(`${host.jar}.previous`), previousJar);
      assert.equal(await outcome.read(`${host.environmentFile}.previous`), installedEnvironment(host));
      assert.equal(await outcome.mode(`${host.environmentFile}.previous`), 0o600);
      assert.equal(await outcome.read(`${host.jar}.next`), null);
      assert.equal(await outcome.read(`${host.environmentFile}.next`), null);
      assert.deepEqual(restarted(outcome), ["release-2"]);
      assert.deepEqual(started(outcome, "systemctl"), [`systemctl restart ${host.unit}`]);
      assert.deepEqual(started(outcome, "aws"), [
        `aws s3api get-object --region ${region} --bucket ${bucket} --key artifacts/${host.profile}/${demoSha}/${sha256(artifact)}.jar --version-id object-version-2 ${outcome.root}${host.jar}.next`
      ]);
      const polls = started(outcome, "curl");
      assert.ok(polls.length > 2);
      for (const poll of polls) {
        assert.equal(poll, `curl --fail --silent --max-time 10 -H x-eacl-request-id: ec2-release-health http://127.0.0.1:${host.port}/health`);
      }
      assert.doesNotMatch(outcome.stdout, /did not become healthy|is not kept|Restoring|previous release|"ready"/u);
      assert.ok(outcome.elapsed >= 30 && outcome.elapsed <= 32, `took ${outcome.elapsed} s`);
    });

    test("gives a slow start the same 360 s as before", async (t) => {
      const artifact = jar("release-2", 350);
      const outcome = await release(t, host, { artifact });
      assert.equal(outcome.status, 0, outcome.stderr);
      assert.equal(await outcome.read(host.jar), artifact);
      assert.deepEqual(restarted(outcome), ["release-2"]);
      assert.ok(outcome.elapsed >= 350 && outcome.elapsed <= 352, `took ${outcome.elapsed} s`);
    });

    test("restores the previous release when the new one never answers /health", async (t) => {
      const outcome = await release(t, host, { artifact: brokenJar });
      assert.equal(outcome.status, 1);
      await assertPreviousReleaseInstalled(host, outcome);
      assert.equal(await outcome.read("/state/running.jar"), previousJar);
      assert.equal(await outcome.read("/state/running.env"), installedEnvironment(host));
      // The restored pair stays kept, for the next attempt.
      assert.equal(await outcome.read(`${host.jar}.previous`), previousJar);
      assert.equal(await outcome.read(`${host.environmentFile}.previous`), installedEnvironment(host));
      assert.deepEqual(restarted(outcome), ["release-2", "release-1"]);
      assert.ok(outcome.restarts[1].at >= 360 && outcome.restarts[1].at <= 372,
        `restored after ${outcome.restarts[1].at} s`);
      assertOrdered(outcome.stdout, [
        "The new release did not become healthy.",
        `${host.unit}: activating (auto-restart) release-2`,
        `Last lines of ${outcome.root}${host.logFile}:`,
        "release-1: reader listening",
        "release-2: Execution error (ExceptionInfo) :datalevin/frozen-attribute-write",
        `Restoring artifact ${sha256(previousJar)}.`,
        "The previous release is restored and healthy.",
        `${host.unit}: active (running) release-1`
      ]);
      assert.equal(outcome.stdout.split("\n").filter((line) => line === "earlier line").length, 38);
      assert.ok(outcome.elapsed >= 380 && outcome.elapsed <= 394, `took ${outcome.elapsed} s`);
    });

    test("keeps a release that misses a health request while it is busy", async (t) => {
      const outcome = await release(t, host, { artifact: brokenJar, missedRequests: 2 });
      assert.equal(outcome.status, 1);
      await assertPreviousReleaseInstalled(host, outcome);
      assert.deepEqual(restarted(outcome), ["release-2", "release-1"]);
      assert.match(outcome.stdout, /The previous release is restored and healthy\./u);
    });

    test("restores the previous release when the unit cannot even be restarted", async (t) => {
      const outcome = await release(t, host, { artifact: jar("release-2", 30), restartFails: "release-2" });
      assert.equal(outcome.status, 1);
      await assertPreviousReleaseInstalled(host, outcome);
      assert.deepEqual(restarted(outcome), ["release-2", "release-1"]);
      assert.match(outcome.stdout, /The previous release is restored and healthy\./u);
    });

    test("keeps the last good release when a release that was cut off is tried again", async (t) => {
      // An earlier command installed release-2 and was stopped before it could
      // restore: release-2 is installed and failing, release-1 is what is kept.
      const outcome = await release(t, host, {
        artifact: jar("release-3", "never"),
        installed: brokenJar,
        environment: releasedEnvironment(host, brokenJar),
        kept: { jar: previousJar, environment: installedEnvironment(host) }
      });
      assert.equal(outcome.status, 1);
      await assertPreviousReleaseInstalled(host, outcome);
      assert.deepEqual(restarted(outcome), ["release-3", "release-1"]);
      assertOrdered(outcome.stdout, [
        "The installed release is not kept: it is not answering /health as itself.",
        "The new release did not become healthy.",
        `Restoring artifact ${sha256(previousJar)}.`,
        "The previous release is restored and healthy."
      ]);
    });

    test("keeps the last good release when it is down at the next attempt", async (t) => {
      // A restore put release-1 back and left it kept, and release-1 has since
      // stopped answering.
      const outcome = await release(t, host, {
        artifact: brokenJar, kept: "linked", running: { jar: null, environment: installedEnvironment(host) }
      });
      assert.equal(outcome.status, 1);
      await assertPreviousReleaseInstalled(host, outcome);
      assert.equal(await outcome.read(`${host.jar}.previous`), previousJar);
      assert.deepEqual(restarted(outcome), ["release-2", "release-1"]);
      assertOrdered(outcome.stdout, [
        "The installed release is not kept: it is not answering /health as itself.",
        "The new release did not become healthy.",
        `Restoring artifact ${sha256(previousJar)}.`,
        "The previous release is restored and healthy."
      ]);
    });

    test("leaves a release alone that is already installed and answering", async (t) => {
      const artifact = jar("release-2", 30);
      const outcome = await release(t, host, {
        artifact,
        installed: artifact,
        environment: releasedEnvironment(host, artifact),
        kept: { jar: previousJar, environment: installedEnvironment(host) }
      });
      assert.equal(outcome.status, 0, outcome.stderr);
      assert.deepEqual(restarted(outcome), []);
      assert.equal(await outcome.read(host.jar), artifact);
      assert.equal(await outcome.read(host.environmentFile), releasedEnvironment(host, artifact));
      assert.equal(await outcome.read(`${host.jar}.previous`), previousJar);
      assert.equal(await outcome.read(`${host.environmentFile}.previous`), installedEnvironment(host));
      assert.equal(await outcome.read(`${host.jar}.next`), null);
      assert.equal(await outcome.read(`${host.environmentFile}.next`), null);
      assert.match(outcome.stdout, /This release is already installed and answering \/health\./u);
      assert.equal(outcome.elapsed, 0);
    });

    test("keeps nothing that the running service was not started from", async (t) => {
      // The files on disk were replaced without a restart. The service that
      // answers /health is still release-1, while the installed pair names
      // another artifact or another commit, or holds another jar.
      const running = { jar: previousJar, environment: installedEnvironment(host) };
      const renamed = (line, value) => running.environment.replace(new RegExp(`^${line}=.*$`, "mu"), `${line}=${value}`);
      for (const [what, installed, environment] of [
        ["artifact", jar("release-2", 30), renamed("EACL_ARTIFACT_SHA256", sha256(jar("release-2", 30)))],
        ["commit", previousJar, renamed("EACL_DEMO_SHA", "f".repeat(40))],
        ["jar", jar("release-2", 30), running.environment]
      ]) {
        const outcome = await release(t, host, { artifact: jar("release-3", "never"), installed, environment, running });
        assert.equal(outcome.status, 1, what);
        assert.equal(await outcome.read(`${host.jar}.previous`), null, what);
        assert.equal(await outcome.read(`${host.environmentFile}.previous`), null, what);
        assert.deepEqual(restarted(outcome), ["release-3"], what);
        assert.match(outcome.stdout, /No earlier release is kept on this host/u, what);
      }
    });

    test("releases over a pair that an interrupted command left linked", async (t) => {
      const artifact = jar("release-2", 30);
      const outcome = await release(t, host, { artifact, kept: "linked" });
      assert.equal(outcome.status, 0, outcome.stderr);
      assert.equal(await outcome.read(host.jar), artifact);
      assert.equal(await outcome.read(`${host.jar}.previous`), previousJar);
      assert.equal(await outcome.read(`${host.environmentFile}.previous`), installedEnvironment(host));
    });

    test("installs the first release on a host where nothing is running", async (t) => {
      const artifact = jar("release-2", 30);
      const outcome = await release(t, host, { artifact, installed: null });
      assert.equal(outcome.status, 0, outcome.stderr);
      assert.equal(await outcome.read(host.jar), artifact);
      assert.equal(await outcome.read(host.environmentFile), releasedEnvironment(host, artifact));
      assert.equal(await outcome.read(`${host.jar}.previous`), null);
      assert.equal(await outcome.read(`${host.environmentFile}.previous`), null);
      assert.deepEqual(restarted(outcome), ["release-2"]);
      // It first gives a running service 30 s to answer.
      assert.ok(outcome.elapsed >= 60 && outcome.elapsed <= 64, `took ${outcome.elapsed} s`);
    });

    test("reports a first release that never starts and has nothing to restore", async (t) => {
      const outcome = await release(t, host, { artifact: brokenJar, installed: null });
      assert.equal(outcome.status, 1);
      assert.equal(await outcome.read(host.jar), brokenJar);
      assert.equal(await outcome.read(`${host.jar}.previous`), null);
      assert.deepEqual(restarted(outcome), ["release-2"]);
      assertOrdered(outcome.stdout, [
        "The installed release is not kept: it is not answering /health as itself.",
        "The new release did not become healthy.",
        `${host.unit}: activating (auto-restart) release-2`,
        "release-2: Execution error (ExceptionInfo) :datalevin/frozen-attribute-write",
        "No earlier release is kept on this host, so the new release stays installed."
      ]);
      assert.ok(outcome.elapsed >= 390 && outcome.elapsed <= 404, `took ${outcome.elapsed} s`);
    });

    test("leaves the host alone when the downloaded jar fails its sha256 check", async (t) => {
      const outcome = await release(t, host, { artifact: jar("release-2", 30), delivered: jar("tampered", 30) });
      assert.notEqual(outcome.status, 0);
      await assertPreviousReleaseInstalled(host, outcome);
      assert.equal(await outcome.read(`${host.jar}.previous`), null);
      assert.equal(await outcome.read(`${host.environmentFile}.previous`), null);
      assert.deepEqual([...started(outcome, "systemctl"), ...started(outcome, "curl")], []);
    });

    test("leaves the host alone when the environment file lacks a release line", async (t) => {
      const environment = installedEnvironment(host).replace(/^EACL_DEPLOYMENT_ID=.*\n/mu, "");
      const outcome = await release(t, host, { artifact: jar("release-2", 30), environment, staged: true });
      assert.notEqual(outcome.status, 0);
      assert.equal(await outcome.read(host.jar), previousJar);
      assert.equal(await outcome.read(host.environmentFile), environment);
      assert.equal(await outcome.read(`${host.jar}.previous`), null);
      assert.deepEqual([...started(outcome, "systemctl"), ...started(outcome, "curl")], []);
      // The staged file that is left behind holds the cursor key.
      assert.equal(await outcome.mode(`${host.environmentFile}.next`), 0o600);
    });

    test("ends both health waits inside the 900 s the job allows, however slowly the host answers", async (t) => {
      // The worst case: the new release never starts and the previous one does
      // not come back, every health request hangs until curl gives up, each
      // stop runs into systemd's timeout, the download is slow and the log
      // lines are long.
      const installed = jar("release-1", "once");
      const outcome = await release(t, host, {
        artifact: brokenJar, installed, hang: true, stopSeconds: host.stopSeconds, downloadSeconds: 30,
        log: `${"y".repeat(500)}\n`.repeat(60)
      });
      assert.equal(outcome.status, 1);
      await assertPreviousReleaseInstalled(host, outcome, installed);
      assert.deepEqual(restarted(outcome), ["release-2", "release-1"]);
      assertOrdered(outcome.stdout, [
        "The new release did not become healthy.",
        `${host.unit}: activating (auto-restart) release-2`,
        "release-2: Execution error (ExceptionInfo) :datalevin/frozen-attribute-write",
        `Restoring artifact ${sha256(installed)}.`,
        "The previous release did not become healthy either.",
        `${host.unit}: activating (auto-restart) release-1`,
        "release-1: Execution error (ExceptionInfo) :datalevin/frozen-attribute-write"
      ]);
      assert.ok(outcome.stdout.length < ssmStandardOutputCharacters, `printed ${outcome.stdout.length} characters`);
      assert.ok(outcome.elapsed >= 840 && outcome.elapsed <= 900, `took ${outcome.elapsed} s`);
    });

    test("the job prints what a failed release printed and fails without waiting out the public origin", async (t) => {
      const outcome = await release(t, host, { artifact: brokenJar });
      assert.equal(outcome.status, 1);
      // SSM adds this line to what a failed command wrote to stderr.
      const failed = invocation("Failed", outcome.status, outcome.stdout,
        `${outcome.stderr}failed to run commands: exit status ${outcome.status}`);
      const wait = waiting({
        origin: previousRelease,
        ssm: (second) => (second < outcome.elapsed ? invocation("InProgress", -1) : failed)
      });
      const { written, done } = deployment(host, brokenJar, wait);
      await assert.rejects(done,
        new RegExp(`^Error: ${host.profile}-ec2 command ${commandId} failed on its host: Failed, exit code 1$`, "u"));
      assert.ok(wait.seconds() >= outcome.elapsed && wait.seconds() <= outcome.elapsed + 8,
        `the job failed after ${wait.seconds()} s, the command after ${outcome.elapsed} s`);
      const log = written.join("");
      assertOrdered(log, [
        `sent ${host.profile}-ec2 command ${commandId}\n`,
        `${host.profile}-ec2 command ${commandId} is InProgress\n`,
        `${host.profile}-ec2 command ${commandId} ended on its host: Failed, exit code 1\n`,
        "standard output:\n",
        "The new release did not become healthy.",
        `${host.unit}: activating (auto-restart) release-2`,
        "release-2: Execution error (ExceptionInfo) :datalevin/frozen-attribute-write",
        `Restoring artifact ${sha256(previousJar)}.`,
        "The previous release is restored and healthy.",
        "standard error:\n",
        "failed to run commands: exit status 1\n"
      ]);
      assert.ok(log.includes(outcome.stdout), "the job log lacks part of what the command printed");
      assert.equal(log.includes(cursorKey), false, "the job printed the cursor key");
      assert.doesNotMatch(log, /^deployed /mu);
      assert.doesNotMatch(log, /stop-commands/u);
      // Every read asks for the command this job sent, on this profile's instance.
      assert.ok(wait.reads.length > 60);
      for (const read of wait.reads) {
        assert.deepEqual(read.args.slice(-6), ["--command-id", commandId, "--instance-id", instanceId, "--output", "json"]);
      }
    });

    test("the job keeps what the host printed apart from workflow commands when it runs in a workflow", async (t) => {
      const outcome = await release(t, host, { artifact: brokenJar });
      const wait = waiting({
        origin: previousRelease,
        environment: { GITHUB_ACTIONS: "true" },
        ssm: () => invocation("Failed", outcome.status, outcome.stdout, outcome.stderr)
      });
      const { written, done } = deployment(host, brokenJar, wait);
      await assert.rejects(done, /failed on its host: Failed, exit code 1$/u);
      const report = written.at(-1).split("\n");
      const token = /^::stop-commands::([0-9a-f-]{36})$/u.exec(report[1])?.[1];
      assert.ok(token, report[1]);
      assert.deepEqual(report.slice(-2), [`::${token}::`, ""]);
      assert.equal(report.indexOf("standard output:"), 2);
    });

    test("the job waits for the public origin as it did before when its role may not read the result", async () => {
      const artifact = jar("release-2", 30);
      const told = `${host.profile}-ec2 command ${commandId}: this job's role may not read the command's result (ssm:GetCommandInvocation), so only the public origin is checked\n`;
      for (const stderr of cliErrors("AccessDeniedException", deniedMessage)) {
        // The release never shows at the origin, as after a restore.
        const restored = waiting({ origin: previousRelease, ssm: () => ({ stderr }) });
        const failing = deployment(host, artifact, restored);
        await assert.rejects(failing.done, new RegExp(
          `^Error: ${host.profile} public origin smoke failed after deployment propagation: ` +
          `\\{"status":200,"contentType":"application/json","identity":\\{.*"artifactSha256":"${sha256(previousJar)}"`, "u"));
        assert.equal(restored.seconds(), 900);
        assert.equal(restored.reads.length, 1);
        assert.deepEqual(failing.written, [`sent ${host.profile}-ec2 command ${commandId}\n`, told]);

        // The release shows at the origin after 40 s.
        const released = waiting({ origin: (second) => (second < 40 ? previousRelease() : {}), ssm: () => ({ stderr }) });
        const passing = deployment(host, artifact, released);
        await passing.done;
        assert.equal(released.seconds(), 40);
        assert.equal(released.reads.length, 1);
        assert.deepEqual(passing.written, [
          `sent ${host.profile}-ec2 command ${commandId}\n`,
          told,
          `deployed ${host.profile}-ec2 command ${commandId} sha256:${sha256(artifact)}\n`
        ]);
      }
    });

    test("the job still waits for the public origin after the command has succeeded", async (t) => {
      const artifact = jar("release-2", 30);
      const outcome = await release(t, host, { artifact });
      assert.equal(outcome.status, 0, outcome.stderr);
      const running = `${host.profile}-ec2 command ${commandId} is InProgress\n`;
      const succeeded = `${host.profile}-ec2 command ${commandId} succeeded on its host\n`;
      const result = (second) => (second < outcome.elapsed
        ? invocation("InProgress", -1)
        : invocation("Success", 0, outcome.stdout, outcome.stderr));

      const shown = waiting({ origin: (second) => (second < outcome.elapsed + 10 ? previousRelease() : {}), ssm: result });
      const passing = deployment(host, artifact, shown);
      await passing.done;
      assert.ok(shown.seconds() >= outcome.elapsed + 10 && shown.seconds() <= outcome.elapsed + 12,
        `the job passed after ${shown.seconds()} s, the command after ${outcome.elapsed} s`);
      assert.deepEqual(passing.written, [
        `sent ${host.profile}-ec2 command ${commandId}\n`,
        running,
        succeeded,
        `deployed ${host.profile}-ec2 command ${commandId} sha256:${sha256(artifact)}\n`
      ]);

      const unseen = waiting({ origin: previousRelease, ssm: result });
      const failing = deployment(host, artifact, unseen);
      await assert.rejects(failing.done, new RegExp(`^Error: ${host.profile} public origin smoke failed after deployment propagation: `, "u"));
      assert.equal(unseen.seconds(), 900);
      assert.deepEqual(failing.written, [`sent ${host.profile}-ec2 command ${commandId}\n`, running, succeeded]);
    });
  });
}
