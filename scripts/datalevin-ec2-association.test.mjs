import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, constants, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const template = await readFile(new URL("../infra/profiles/datalevin-memory-ec2.yaml", import.meta.url), "utf8");

const region = "us-east-1";
const bucket = "eacl-demo-artifacts";
const cursorKey = "c".repeat(64);
const epoch = 1_800_000_000;
const unitName = "eacl-demo-datalevin.service";
const jarFile = "/opt/eacl-demo/datalevin.jar";
const environmentFile = "/etc/eacl-demo-datalevin.env";
const unitFile = `/etc/systemd/system/${unitName}`;
const marker = "/run/eacl-demo-datalevin.restart-required";
const staged = [jarFile, environmentFile, unitFile].map((file) => `${file}.stack`);

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// A host that exists only under a temporary directory. Paths the association
// names under these four directories are moved there; the directory itself may
// lie under /var, so text is moved exactly once.
const hostPath = /(?<![\w.-])\/(?:opt|etc|var|run)\//gu;
// The association runs on the machine that runs this test, so it must name no
// other path of that machine. Apart from two devices, the java binary the unit
// names and the log group in the agent configuration, every absolute path it
// names lies under a directory that is moved.
const elsewhere = new Set(["/dev/null", "/dev/urandom", "/usr/bin/java", "/aws/ec2/eacl-demo-datalevin-memory"]);
const pathsNamed = (text) => text.match(/(?<![\w.\/}-])\/[A-Za-z][\w.\/-]*/gu) ?? [];
const outsideFakeHost = (text) => pathsNamed(text)
  .filter((named) => !elsewhere.has(named) && named.replace(hostPath, "") === named);

// A fake jar describes the service it would run: its name, then how many
// seconds after a start it begins to answer /health. `never` is a jar that
// cannot start.
const jar = (name, startup) => `${name}\n${startup}\n`;
const release = (artifact, demoSha, eaclSha) => ({
  artifact, artifactSha256: sha256(artifact), demoSha, eaclSha,
  deploymentId: `production:${demoSha}:datalevin-memory`
});
// What the stack's parameters name, and two releases that reached the host
// over SSM afterwards: one from a later commit that built the same jar, and
// one with a jar of its own.
const stackRelease = release(jar("stack-release", 20), "a".repeat(40), "b".repeat(40));
const sameJarRelease = release(stackRelease.artifact, "d".repeat(40), stackRelease.eaclSha);
const laterRelease = release(jar("later-release", 20), "d".repeat(40), "e".repeat(40));

const parametersFor = (stack) => ({
  "AWS::Region": region,
  ArtifactBucket: bucket,
  ArtifactKey: `artifacts/datalevin-memory/${stack.demoSha}/${stack.artifactSha256}.jar`,
  ArtifactVersion: "object-version-1",
  ArtifactSha256: stack.artifactSha256,
  DemoSha: stack.demoSha,
  EaclSha: stack.eaclSha,
  DeploymentId: stack.deploymentId
});

// The association is one `!Sub |` block. YAML strips its indentation and
// CloudFormation replaces each ${Name}; nothing else happens to the text on
// its way to the host.
const resource = /\n  RuntimeAssociation:\n[\s\S]*?(?=\n  \S)/u.exec(template)?.[0];
assert.ok(resource, "the template no longer declares RuntimeAssociation");
const commandItems = resource.split("\n").filter((line) => /^ {10}- /u.test(line));
const associationText = (() => {
  const lines = resource.split("\n");
  const start = lines.findIndex((line) => /^ {10}- !Sub \|$/u.test(line));
  assert.notEqual(start, -1, "the association is no longer one !Sub block");
  const indentation = /^ */u.exec(lines[start + 1])[0].length;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && /^ */u.exec(line)[0].length < indentation) break;
    body.push(line.slice(indentation));
  }
  return `${body.join("\n").replace(/\n+$/u, "")}\n`;
})();
const references = [...associationText.matchAll(/\$\{([^}]*)\}/gu)].map((match) => match[1]);

function associationCommand(parameters) {
  return associationText.replace(/\$\{([^}]*)\}/gu, (reference, name) => {
    if (name.startsWith("!")) return `\${${name.slice(1)}}`;
    assert.ok(name in parameters, `the test supplies no value for ${reference}`);
    return parameters[name];
  });
}

// The unit the template writes, and the environment file as the association
// and the release command leave it.
const unit = /<<'SERVICE'\n([\s\S]*?\n)SERVICE\n/u.exec(associationText)?.[1];
assert.ok(unit, "the association no longer writes the unit from a SERVICE here-document");
const environment = ({ artifactSha256, eaclSha, demoSha, deploymentId }, { key = cursorKey, workers = 1 } = {}) => `${[
  "AWS_LAMBDA_FUNCTION_NAME=eacl-demo-datalevin-memory-ec2",
  `EACL_ARTIFACT_SHA256=${artifactSha256}`,
  `EACL_CORE_SHA=${eaclSha}`,
  `EACL_CURSOR_KEY=${key}`,
  `EACL_DEMO_SHA=${demoSha}`,
  `EACL_DEPLOYMENT_ID=${deploymentId}`,
  "EACL_DATALEVIN_DIRECTORY=/var/lib/eacl-demo/datalevin",
  "EACL_HTTP_PORT=8081",
  `EACL_HTTP_WORKERS=${workers}`,
  "EACL_MAXIMUM_CONCURRENCY=1",
  "EACL_RUNTIME_EXECUTION=ec2",
  "EACL_RUNTIME_MEMORY_MIB=1024"
].join("\n")}\n`;
const installedRelease = (installed, options) => ({
  jar: installed.artifact, environment: environment(installed, options), unit
});

// Children get no standard input: a pipe from Node is a socket, and a shell
// that reads from a socket takes itself for a remote shell.
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

// The association gets a PATH that holds these host tools and nothing else,
// so a command that reached for the real aws, systemctl, curl or sleep, or for
// a tool the host may not have, would fail here. `sh` is bash, as it is on
// Amazon Linux 2023, where the SSM agent runs the commands with sh.
async function toolDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eacl-datalevin-association-tools-"));
  assert.match(directory, /^[\w/.-]+$/u, "the temporary directory must not need shell quoting");
  const bash = await onPath("bash");
  assert.ok(bash, "bash is not on PATH");
  await symlink(bash, path.join(directory, "sh"));
  for (const name of ["seq", "install", "sed", "grep", "chmod", "mv", "rm", "cat", "head", "base64", "tr", "wc", "touch"]) {
    const tool = await onPath(name);
    assert.ok(tool, `${name} is not on PATH`);
    await symlink(tool, path.join(directory, name));
  }
  // The host has GNU sha256sum. Where the local one cannot check a digest
  // line the same way, shasum takes the same flags and prints the same lines.
  const probe = path.join(directory, "probe");
  await writeFile(probe, "probe");
  const checks = async (tool) => tool !== null && (await run(bash, ["-c",
    `echo '${sha256("probe")}  ${probe}' | ${tool} --check --strict --status && ` +
    `[ "$(${tool} < ${probe})" = '${sha256("probe")}  -' ] && ` +
    `! echo '${sha256("other")}  ${probe}' | ${tool} --check --strict --status && ` +
    `! printf '%s\\n' not-a-digest '${sha256("probe")}  ${probe}' | ${tool} --check --strict --status`])).status === 0;
  const sha256sum = await onPath("sha256sum");
  if (await checks(sha256sum)) {
    await symlink(sha256sum, path.join(directory, "sha256sum"));
  } else {
    const shasum = await onPath("shasum");
    assert.ok(await checks(shasum === null ? null : `${shasum} -a 256`),
      "neither sha256sum nor shasum can check a digest here");
    await writeFile(path.join(directory, "sha256sum"), `#!${bash}\nexec ${shasum} -a 256 "$@"\n`);
    await chmod(path.join(directory, "sha256sum"), 0o755);
  }
  await rm(probe);
  const ls = await onPath("ls");
  assert.ok(ls, "ls is not on PATH");
  return { directory, bash, ls };
}

// EACL_ASSOCIATION_IMAGE runs the association with the shell and the tools of
// a container image instead of the local ones. The host runs Amazon Linux 2023:
//   EACL_ASSOCIATION_IMAGE=public.ecr.aws/amazonlinux/amazonlinux:2023 node --test scripts/datalevin-ec2-association.test.mjs
const image = process.env.EACL_ASSOCIATION_IMAGE || null;
const skip = process.platform === "win32" ? "the association needs a POSIX shell" : false;
const tools = skip ? null : image === null ? await toolDirectory() : { directory: null, bash: "/bin/bash", ls: "/bin/ls" };
after(async () => {
  if (tools?.directory) await rm(tools.directory, { recursive: true, force: true });
});

// Stand-ins for the commands that would reach AWS, systemd, the service and
// the clock. The script sources them before the association's text, so each
// is a function of the shell that runs it: a poll costs no process, and
// `sleep` moves a clock instead of waiting, so a six-minute health wait takes
// no real time. They share that shell with the association, so every variable
// is local and every path is written out.
function standIns({ root, state }) {
  const liveJar = `${root}${jarFile}`;
  const liveEnvironment = `${root}${environmentFile}`;
  const liveUnit = `${root}${unitFile}`;
  return `${[
    "unexpected() {",
    `  echo "unexpected $*" >&2`,
    `  echo "$*" >> ${state}/unexpected`,
    "  return 64",
    "}",
    // A step that the test makes fail once.
    "fails() {",
    `  [ -e ${state}/fail.$1 ] || return 1`,
    `  rm -f ${state}/fail.$1`,
    "}",
    // When the running service starts to answer /health. systemd starts the
    // unit it loaded last, and the reader refuses an environment that lacks
    // what parse-environment in lambda_handler.clj requires.
    "answers_from() {",
    "  local name startup started pattern",
    `  { read -r name && read -r startup; } < ${state}/running.jar || { echo never; return 0; }`,
    `  [ "$startup" != never ] || { echo never; return 0; }`,
    `  grep -Fqx -- "EnvironmentFile=${liveEnvironment}" ${state}/running.unit || { echo never; return 0; }`,
    `  grep -Fq -- " -cp ${liveJar} clojure.main -m eacl-demo.datalevin-memory.http-server" ${state}/running.unit || { echo never; return 0; }`,
    "  for pattern in 'EACL_DEMO_SHA=[0-9a-f]{40}' 'EACL_ARTIFACT_SHA256=[0-9a-f]{64}' \\",
    "      'EACL_DEPLOYMENT_ID=[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}' 'EACL_CURSOR_KEY=.{32,}' \\",
    "      'EACL_DATALEVIN_DIRECTORY=/.+' 'EACL_RUNTIME_MEMORY_MIB=[1-9][0-9]{0,8}' \\",
    "      'EACL_MAXIMUM_CONCURRENCY=[1-9][0-9]{0,8}' 'EACL_RUNTIME_EXECUTION=ec2' 'EACL_HTTP_PORT=8081'; do",
    `    grep -Eqx -- "$pattern" ${state}/running.env || { echo never; return 0; }`,
    "  done",
    `  read -r started < ${state}/started`,
    "  echo $((started + startup))",
    "}",
    "answers() {",
    "  local active from clock",
    `  read -r active < ${state}/active`,
    `  [ "$active" = yes ] || return 1`,
    `  [ -e ${state}/answers-from ] || answers_from > ${state}/answers-from`,
    `  read -r from < ${state}/answers-from`,
    `  read -r clock < ${state}/clock`,
    `  [ "$from" != never ] && [ "$clock" -ge "$from" ]`,
    "}",
    // Starts the service from what is installed and what systemd has loaded.
    "launch() {",
    "  local name clock",
    `  if [ -e ${liveJar} ]; then echo "$(<${liveJar})" > ${state}/running.jar; else : > ${state}/running.jar; fi`,
    `  if [ -e ${liveEnvironment} ]; then echo "$(<${liveEnvironment})" > ${state}/running.env; else : > ${state}/running.env; fi`,
    `  echo "$(<${state}/loaded.unit)" > ${state}/running.unit`,
    `  read -r clock < ${state}/clock`,
    `  echo "$clock" > ${state}/started`,
    `  echo yes > ${state}/active`,
    `  rm -f ${state}/answers-from`,
    `  read -r name < ${state}/running.jar || name=nothing`,
    `  echo "$((clock - ${epoch})) $1 $name" >> ${state}/starts`,
    "}",
    "sleep() {",
    "  local clock boot",
    `  read -r clock < ${state}/clock`,
    "  clock=$((clock + $1))",
    `  echo "$clock" > ${state}/clock`,
    // The first boot touches this file when its packages are installed.
    `  if [ -e ${state}/first-boot ]; then`,
    `    read -r boot < ${state}/first-boot`,
    `    if [ "$clock" -ge "$boot" ]; then : > ${root}/opt/eacl-demo/bootstrap-ready; fi`,
    "  fi",
    "}",
    "aws() {",
    `  echo "aws $*" >> ${state}/calls`,
    `  [ "$1 $2" = "s3api get-object" ] || { unexpected aws "$@"; return 64; }`,
    "  if fails s3; then",
    `    echo "An error occurred (NoSuchVersion) when calling the GetObject operation: The specified version does not exist." >&2`,
    "    return 254",
    "  fi",
    // The object is written to the last argument.
    "  local outfile",
    "  for outfile; do :; done",
    `  echo "$(<${state}/artifact)" > "$outfile"`,
    `  echo '{"VersionId": "object-version-1"}'`,
    "}",
    "systemctl() {",
    `  echo "systemctl $*" >> ${state}/calls`,
    "  local active name",
    `  case "$*" in`,
    "    daemon-reload)",
    `      if fails daemon-reload; then echo "Failed to reload daemon: Connection timed out" >&2; return 1; fi`,
    `      if [ -e ${liveUnit} ]; then echo "$(<${liveUnit})" > ${state}/loaded.unit; fi`,
    "      ;;",
    `    "enable ${unitName}")`,
    `      [ -s ${state}/loaded.unit ] || { echo "Failed to enable unit: Unit file ${unitName} does not exist." >&2; return 1; }`,
    `      : > ${state}/enabled`,
    "      ;;",
    `    "start ${unitName}")`,
    `      read -r active < ${state}/active`,
    `      if [ "$active" != yes ]; then launch start; fi`,
    "      ;;",
    `    "restart ${unitName}")`,
    `      if fails restart; then echo "Job for ${unitName} failed because the control process exited with error code." >&2; return 1; fi`,
    "      launch restart",
    "      ;;",
    `    "status ${unitName} --no-pager")`,
    `      read -r name < ${state}/running.jar || name=nothing`,
    `      if answers; then echo "${unitName}: active (running) $name"; return 0; fi`,
    `      echo "${unitName}: activating (auto-restart) $name"`,
    "      return 3",
    "      ;;",
    `    *) unexpected systemctl "$@"; return 64 ;;`,
    "  esac",
    "}",
    "curl() {",
    `  echo "curl $*" >> ${state}/calls`,
    `  [ "$*" = "--fail --silent http://127.0.0.1:8081/health" ] || { unexpected curl "$@"; return 64; }`,
    "  answers || return 7",
    `  echo '{"data":{"status":"ready","ready":true}}'`,
    "}"
  ].join("\n")}\n`;
}

// The agent's control command is called by its path, so it is a script. It
// runs after everything is staged and before anything is renamed, so it also
// notes how the staged environment file, which holds the cursor key, is
// protected at that moment.
function agentControl({ bash, ls, root, state }) {
  return `${[
    `#!${bash}`,
    `echo "agent $*" >> ${state}/calls`,
    `listing=$(${ls} -ld ${root}${environmentFile}.stack 2>/dev/null) || listing=missing`,
    `echo "\${listing%% *}" >> ${state}/staged-environment`,
    `if [ -e ${state}/fail.agent ]; then`,
    `  rm -f ${state}/fail.agent`,
    `  echo "Configuration validation first phase failed. Agent version: 1.0. Verify the JSON input is only using features supported by this version." >&2`,
    "  exit 1",
    "fi"
  ].join("\n")}\n`;
}

async function fakeHost(t, {
  // The jar, environment file and unit on disk; null is a host on which the
  // association has never run.
  installed = null,
  // What the service process was started from, or null when it is not running.
  running = installed,
  // The modes of the installed environment file and unit.
  modes = { environment: 0o600, unit: 0o644 },
  // A pair kept beside the installed one as <file>.previous: "linked" shares
  // its files with the installed pair, as a release command leaves them that
  // keeps the replaced pair by hard link and puts it back the same way.
  kept = null,
  // The staged pair that the release command on production leaves behind.
  leftovers = false,
  // Seconds until the first boot has installed its packages, or "never".
  firstBoot = 0
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "eacl-datalevin-association-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.match(root, /^[\w/.-]+$/u, "the temporary directory must not need shell quoting");
  const at = (file) => `${root}${file}`;
  const onHost = (text) => text.replace(hostPath, (directory) => `${root}${directory}`);
  const state = at("/state");
  for (const directory of [
    "/state", "/run", "/opt/eacl-demo", "/etc/systemd/system", "/var/lib", "/var/log/eacl-demo",
    "/opt/aws/amazon-cloudwatch-agent/etc", "/opt/aws/amazon-cloudwatch-agent/bin"
  ]) {
    await mkdir(at(directory), { recursive: true });
  }
  if (firstBoot === 0) await writeFile(at("/opt/eacl-demo/bootstrap-ready"), "");
  else if (firstBoot !== "never") await writeFile(`${state}/first-boot`, `${epoch + firstBoot}\n`);

  const place = async (file, text, mode) => {
    await writeFile(at(file), text);
    await chmod(at(file), mode);
  };
  if (installed?.jar != null) await place(jarFile, installed.jar, 0o644);
  if (installed?.environment != null) await place(environmentFile, onHost(installed.environment), modes.environment);
  if (installed?.unit != null) await place(unitFile, onHost(installed.unit), modes.unit);
  if (kept === "linked") {
    await link(at(jarFile), at(`${jarFile}.previous`));
    await link(at(environmentFile), at(`${environmentFile}.previous`));
  } else if (kept !== null) {
    await place(`${jarFile}.previous`, kept.jar, 0o644);
    await place(`${environmentFile}.previous`, onHost(kept.environment), 0o600);
  }
  if (leftovers) {
    await place(`${jarFile}.next`, installed.jar, 0o644);
    await place(`${environmentFile}.next`, onHost(installed.environment), 0o644);
  }

  await writeFile(`${state}/clock`, `${epoch}\n`);
  await writeFile(`${state}/calls`, "");
  await writeFile(`${state}/starts`, "");
  await writeFile(`${state}/staged-environment`, "");
  // systemd loaded the installed unit at boot, and the running service
  // started long ago.
  await writeFile(`${state}/loaded.unit`, onHost(installed?.unit ?? ""));
  await writeFile(`${state}/active`, running === null ? "no\n" : "yes\n");
  await writeFile(`${state}/started`, `${epoch - 86_400}\n`);
  await writeFile(`${state}/running.jar`, running?.jar ?? "");
  await writeFile(`${state}/running.env`, onHost(running?.environment ?? ""));
  await writeFile(`${state}/running.unit`, onHost(running?.unit ?? ""));

  await writeFile(`${state}/stand-ins.sh`, standIns({ root, state }));
  const control = at("/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl");
  await writeFile(control, agentControl({ ...tools, root, state }));
  await chmod(control, 0o755);

  const exists = async (file) => {
    try {
      await stat(at(file));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };
  // What a file holds, in the host's own paths.
  const read = async (file) => (await exists(file)) ? (await readFile(at(file), "utf8")).replaceAll(root, "") : null;
  const lines = async (file) => (await readFile(`${state}/${file}`, "utf8")).split("\n").filter(Boolean);
  const cursorKeys = async () => {
    const keys = new Set([cursorKey]);
    for (const file of [environmentFile, `${environmentFile}.previous`]) {
      const key = /^EACL_CURSOR_KEY=(.+)$/mu.exec(await read(file) ?? "")?.[1];
      if (key) keys.add(key);
    }
    return keys;
  };

  // Runs the association the way the SSM agent does, as an sh script, with the
  // stand-ins defined first.
  async function apply({
    stack = stackRelease,
    // What S3 holds under the stack's key and version.
    delivered = stack.artifact,
    // Steps that fail once: "s3", "agent", "daemon-reload", "restart".
    failing = []
  } = {}) {
    const command = associationCommand(parametersFor(stack));
    assert.deepEqual(outsideFakeHost(command), [], "the association names a path outside the fake host, so it is not run");
    await writeFile(`${state}/artifact`, delivered);
    for (const step of failing) await writeFile(`${state}/fail.${step}`, "");
    const before = {
      clock: Number(await readFile(`${state}/clock`, "utf8")),
      calls: (await lines("calls")).length,
      starts: (await lines("starts")).length,
      staged: (await lines("staged-environment")).length
    };
    await writeFile(at("/_script.sh"), `. ${state}/stand-ins.sh\n${onHost(command)}`);
    const { status, stdout, stderr } = image === null
      ? await run(path.join(tools.directory, "sh"), ["_script.sh"], { cwd: root, env: { PATH: tools.directory } })
      : await run("docker", ["run", "--rm", "--network", "none", "--volume", `${root}:${root}`, "--workdir", root,
        "--env", "PATH=/usr/bin:/bin", image, "sh", "_script.sh"]);

    assert.equal(await exists("/state/unexpected"), false, `${stdout}${stderr}`);
    // Whatever happened, nothing staged is left behind, the environment file
    // is private, staged or installed, and nothing printed carries a cursor key.
    for (const file of staged) assert.equal(await exists(file), false, `${file} was left behind\n${stdout}${stderr}`);
    if (await exists(environmentFile)) assert.equal((await stat(at(environmentFile))).mode & 0o777, 0o600);
    for (const listing of (await lines("staged-environment")).slice(before.staged)) {
      assert.match(listing, /^-rw-------/u, "the staged environment file was readable by others");
    }
    for (const key of await cursorKeys()) {
      assert.equal(`${stdout}${stderr}`.includes(key), false, "the association printed a cursor key");
    }
    const calls = (await lines("calls")).slice(before.calls).map((call) => call.replaceAll(root, ""));
    const started = (command) => calls.filter((call) => call.startsWith(`${command} `)).map((call) => call.slice(command.length + 1));
    return {
      status, stdout: stdout.replaceAll(root, ""), stderr: stderr.replaceAll(root, ""),
      aws: started("aws"), systemctl: started("systemctl"), curl: started("curl"), agent: started("agent"),
      // Each start of the service: seconds into the test, how, and which jar.
      starts: (await lines("starts")).slice(before.starts),
      elapsed: Number(await readFile(`${state}/clock`, "utf8")) - before.clock
    };
  }

  return {
    apply, read, exists,
    mode: async (file) => (await stat(at(file))).mode & 0o777,
    inode: async (file) => (await stat(at(file))).ino,
    // What the service process is running from.
    runningFrom: async () => ({
      jar: await read("/state/running.jar"), environment: await read("/state/running.env"), unit: await read("/state/running.unit")
    }),
    files: async () => ({ jar: await read(jarFile), environment: await read(environmentFile), unit: await read(unitFile) }),
    inodes: async () => Promise.all([jarFile, environmentFile, unitFile].map(async (file) => (await stat(at(file))).ino))
  };
}

const fetched = (stack) =>
  `s3api get-object --region ${region} --bucket ${bucket} --key artifacts/datalevin-memory/${stack.demoSha}/${stack.artifactSha256}.jar --version-id object-version-1 ${jarFile}.stack`;
const healthPoll = "--fail --silent http://127.0.0.1:8081/health";
const agentCall = "-a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json";
const withoutRestart = ["daemon-reload", `enable ${unitName}`, `start ${unitName}`];
const withRestart = ["daemon-reload", `enable ${unitName}`, `restart ${unitName}`];

async function assertUntouched(machine, outcome, { files, inodes }) {
  assert.deepEqual(await machine.files(), files);
  assert.deepEqual(await machine.inodes(), inodes, "a file was replaced");
  assert.equal(await machine.exists(marker), false);
  assert.deepEqual(outcome.aws, []);
  assert.deepEqual(outcome.starts, []);
  assert.doesNotMatch(outcome.stdout, /Installed|Installing|Restarting/u);
}

test("the association is one command and names only the stack's own parameters", () => {
  assert.equal(commandItems.length, 1);
  const declared = [...(/\nParameters:\n([\s\S]*?)\nResources:\n/u.exec(template)?.[1] ?? "").matchAll(/^ {2}(\w+):/gmu)]
    .map((match) => match[1]);
  assert.ok(declared.includes("ArtifactSha256"));
  // CloudFormation rejects a template whose !Sub names anything else, and a
  // shell ${variable} would be read as such a name.
  for (const name of references) {
    assert.ok(name === "AWS::Region" || declared.includes(name), `\${${name}} is not a parameter of the template`);
  }
  for (const name of ["ArtifactBucket", "ArtifactKey", "ArtifactVersion", "ArtifactSha256", "DemoSha", "EaclSha", "DeploymentId"]) {
    assert.ok(references.includes(name), `the association no longer uses ${name}`);
  }
});

test("the fake host stands in for every path the association names", () => {
  const command = associationCommand(parametersFor(stackRelease));
  const paths = pathsNamed(command);
  for (const file of [jarFile, environmentFile, unitFile, ...staged, marker]) assert.ok(paths.includes(file), file);
  assert.deepEqual(outsideFakeHost(command), []);
  assert.deepEqual(new Set(paths.filter((named) => elsewhere.has(named))), elsewhere);
});

describe("Datalevin EC2 runtime association", { concurrency: image === null, skip }, () => {
  test("installs the stack's release on a fresh host and starts it", async (t) => {
    const machine = await fakeHost(t);
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    const files = await machine.files();
    // A new host gets a cursor key of its own: 48 random bytes.
    const key = /^EACL_CURSOR_KEY=([A-Za-z0-9+/]{64})$/mu.exec(files.environment)?.[1];
    assert.ok(key, "no cursor key was generated");
    assert.deepEqual(files, { jar: stackRelease.artifact, environment: environment(stackRelease, { key }), unit });
    assert.equal(await machine.mode(jarFile), 0o644);
    assert.equal(await machine.mode(unitFile), 0o644);
    assert.equal(await machine.mode("/var/lib/eacl-demo/datalevin"), 0o700);
    assert.deepEqual(outcome.aws, [fetched(stackRelease)]);
    assert.deepEqual(outcome.agent, [agentCall]);
    assert.deepEqual(outcome.systemctl, withRestart);
    assert.deepEqual(outcome.starts, ["0 restart stack-release"]);
    assert.deepEqual(await machine.runningFrom(), files);
    assert.equal(await machine.exists(marker), false);
    assert.ok(outcome.curl.length > 2);
    for (const poll of outcome.curl) assert.equal(poll, healthPoll);
    assert.match(outcome.stdout, new RegExp(`No verified release is installed\\. Installing the stack artifact ${stackRelease.artifactSha256}\\.`, "u"));
    assert.ok(outcome.elapsed >= 20 && outcome.elapsed <= 22, `took ${outcome.elapsed} s`);
  });

  test("waits for the first boot to finish before it installs anything", async (t) => {
    const machine = await fakeHost(t, { firstBoot: 90 });
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.deepEqual(outcome.starts, ["90 restart stack-release"]);
    assert.ok(outcome.elapsed >= 110 && outcome.elapsed <= 112, `took ${outcome.elapsed} s`);

    const unfinished = await fakeHost(t, { firstBoot: "never" });
    const refused = await unfinished.apply();
    assert.notEqual(refused.status, 0);
    assert.deepEqual(await unfinished.files(), { jar: null, environment: null, unit: null });
    assert.deepEqual([...refused.aws, ...refused.agent, ...refused.systemctl, ...refused.curl], []);
    assert.equal(refused.elapsed, 600);
  });

  test("changes nothing when it runs again on the release it installed", async (t) => {
    const machine = await fakeHost(t);
    assert.equal((await machine.apply()).status, 0);
    const before = { files: await machine.files(), inodes: await machine.inodes() };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    await assertUntouched(machine, outcome, before);
    assert.deepEqual(outcome.systemctl, withoutRestart);
    assert.deepEqual(outcome.curl, [healthPoll]);
    assert.match(outcome.stdout, new RegExp(`Keeping the installed release: artifact ${stackRelease.artifactSha256}, commit ${stackRelease.demoSha}\\.`, "u"));
    assert.match(outcome.stdout, /Nothing the service starts from changed, so a running service is not restarted\./u);
    assert.equal(outcome.elapsed, 0);
  });

  test("keeps a release from a later commit that built the stack's own jar", async (t) => {
    // The stack's sha256 is installed, under a later commit and deployment.
    // Writing the stack's release lines here would put the host back on a
    // commit the registry no longer names.
    const machine = await fakeHost(t, { installed: installedRelease(sameJarRelease) });
    const before = { files: await machine.files(), inodes: await machine.inodes() };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    await assertUntouched(machine, outcome, before);
    assert.equal(before.files.environment, environment(sameJarRelease));
    assert.deepEqual(outcome.systemctl, withoutRestart);
    assert.match(outcome.stdout, new RegExp(`Keeping the installed release: artifact ${stackRelease.artifactSha256}, commit ${sameJarRelease.demoSha}\\.`, "u"));
  });

  test("keeps a newer verified release, and what release commands left beside it", async (t) => {
    // The host as releases leave it: a newer release than the stack names, the
    // pair it replaced kept as <file>.previous, and a staged pair left behind.
    const machine = await fakeHost(t, {
      installed: installedRelease(laterRelease),
      kept: { jar: stackRelease.artifact, environment: environment(stackRelease) },
      leftovers: true
    });
    const beside = [jarFile, environmentFile].flatMap((file) => [`${file}.previous`, `${file}.next`]);
    const besideInodes = await Promise.all(beside.map(machine.inode));
    const before = { files: await machine.files(), inodes: await machine.inodes() };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    await assertUntouched(machine, outcome, before);
    assert.deepEqual(before.files, installedRelease(laterRelease));
    assert.deepEqual(await machine.runningFrom(), installedRelease(laterRelease));
    assert.equal(await machine.read(`${jarFile}.previous`), stackRelease.artifact);
    assert.equal(await machine.read(`${environmentFile}.previous`), environment(stackRelease));
    assert.equal(await machine.read(`${jarFile}.next`), laterRelease.artifact);
    assert.equal(await machine.read(`${environmentFile}.next`), environment(laterRelease));
    assert.deepEqual(await Promise.all(beside.map(machine.inode)), besideInodes);
    assert.deepEqual(outcome.agent, [agentCall]);
    assert.deepEqual(outcome.systemctl, withoutRestart);
    assert.deepEqual(outcome.curl, [healthPoll]);
    assert.match(outcome.stdout, new RegExp(`Keeping the installed release: artifact ${laterRelease.artifactSha256}, commit ${laterRelease.demoSha}\\.`, "u"));
    assert.equal(outcome.elapsed, 0);
  });

  test("starts a kept release that is not running, without replacing anything", async (t) => {
    const machine = await fakeHost(t, { installed: installedRelease(laterRelease), running: null });
    const before = { files: await machine.files(), inodes: await machine.inodes() };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.deepEqual(await machine.files(), before.files);
    assert.deepEqual(await machine.inodes(), before.inodes);
    assert.deepEqual(outcome.aws, []);
    assert.deepEqual(outcome.systemctl, withoutRestart);
    assert.deepEqual(outcome.starts, ["0 start later-release"]);
    assert.deepEqual(await machine.runningFrom(), before.files);
    assert.ok(outcome.elapsed >= 20 && outcome.elapsed <= 22, `took ${outcome.elapsed} s`);
  });

  test("installs the stack's release when the installed jar is not the one the environment file names", async (t) => {
    for (const [what, installedJar] of [["another jar", jar("unknown", 20)], ["no jar", null]]) {
      const machine = await fakeHost(t, {
        installed: { ...installedRelease(laterRelease), jar: installedJar },
        running: installedRelease(laterRelease)
      });
      const outcome = await machine.apply();
      assert.equal(outcome.status, 0, `${what}: ${outcome.stderr}`);
      // The host keeps its cursor key, so cursors it issued stay valid.
      const files = { jar: stackRelease.artifact, environment: environment(stackRelease), unit };
      assert.deepEqual(await machine.files(), files, what);
      assert.equal(await machine.mode(jarFile), 0o644, what);
      assert.deepEqual(outcome.aws, [fetched(stackRelease)], what);
      assert.deepEqual(outcome.systemctl, withRestart, what);
      assert.deepEqual(outcome.starts, ["0 restart stack-release"], what);
      assert.deepEqual(await machine.runningFrom(), files, what);
      assert.equal(await machine.exists(marker), false, what);
      assert.match(outcome.stdout, /No verified release is installed/u, what);
      assert.match(outcome.stdout, /Installed \/opt\/eacl-demo\/datalevin\.jar\.\nInstalled \/etc\/eacl-demo-datalevin\.env\.\n/u, what);
      assert.match(outcome.stdout, /Restarting the service, because a file it starts from changed\./u, what);
    }
  });

  test("installs the stack's release when the environment file does not hold each release line once", async (t) => {
    const whole = environment(laterRelease);
    for (const [what, damaged] of [
      ["a missing line", whole.replace(/^EACL_DEPLOYMENT_ID=.*\n/mu, "")],
      ["an empty line", whole.replace(/^EACL_CORE_SHA=.*$/mu, "EACL_CORE_SHA=")],
      ["a repeated line", `${whole}EACL_DEMO_SHA=${"f".repeat(40)}\n`],
      ["no artifact line", whole.replace(/^EACL_ARTIFACT_SHA256=.*\n/mu, "")]
    ]) {
      assert.notEqual(damaged, whole, what);
      const machine = await fakeHost(t, { installed: { ...installedRelease(laterRelease), environment: damaged } });
      const outcome = await machine.apply();
      assert.equal(outcome.status, 0, `${what}: ${outcome.stderr}`);
      assert.deepEqual(await machine.files(),
        { jar: stackRelease.artifact, environment: environment(stackRelease), unit }, what);
      assert.deepEqual(outcome.aws, [fetched(stackRelease)], what);
      assert.deepEqual(outcome.systemctl, withRestart, what);
    }
  });

  test("applies the template to a kept release and restarts it", async (t) => {
    const olderUnit = unit.replace("MemoryMax=352M", "MemoryMax=300M");
    assert.notEqual(olderUnit, unit);
    for (const [what, installed, replaced] of [
      ["environment", { environment: environment(laterRelease, { workers: 2 }) }, [environmentFile]],
      ["unit", { unit: olderUnit }, [unitFile]],
      ["both", { environment: environment(laterRelease, { workers: 2 }), unit: olderUnit }, [environmentFile, unitFile]]
    ]) {
      const machine = await fakeHost(t, { installed: { ...installedRelease(laterRelease), ...installed } });
      const jarInode = await machine.inode(jarFile);
      const outcome = await machine.apply();
      assert.equal(outcome.status, 0, `${what}: ${outcome.stderr}`);
      // The release lines and the cursor key stay; the rest is the template's.
      assert.deepEqual(await machine.files(), installedRelease(laterRelease), what);
      assert.equal(await machine.inode(jarFile), jarInode, what);
      assert.deepEqual(outcome.aws, [], what);
      assert.deepEqual(outcome.systemctl, withRestart, what);
      assert.deepEqual(outcome.starts, ["0 restart later-release"], what);
      // The health wait was answered by a process started from these files.
      assert.deepEqual(await machine.runningFrom(), installedRelease(laterRelease), what);
      assert.equal(await machine.exists(marker), false, what);
      assert.deepEqual([...outcome.stdout.matchAll(/^Installed (.*)\.$/gmu)].map((match) => match[1]), replaced, what);
      assert.match(outcome.stdout, /Keeping the installed release[\s\S]*Restarting the service/u, what);
      assert.ok(outcome.elapsed >= 20 && outcome.elapsed <= 22, `${what} took ${outcome.elapsed} s`);
    }
  });

  test("sets the modes of the files it does not replace", async (t) => {
    const machine = await fakeHost(t, {
      installed: installedRelease(laterRelease), modes: { environment: 0o644, unit: 0o600 }
    });
    const before = { files: await machine.files(), inodes: await machine.inodes() };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    await assertUntouched(machine, outcome, before);
    assert.equal(await machine.mode(environmentFile), 0o600);
    assert.equal(await machine.mode(unitFile), 0o644);
    assert.deepEqual(outcome.systemctl, withoutRestart);
  });

  test("replaces files by renaming, so a hard link to a replaced file keeps the old content", async (t) => {
    // A release command that keeps the pair it replaces by hard link, and puts
    // it back the same way, leaves the installed pair and the kept pair
    // sharing their files. Replacing the environment file must leave the kept
    // one as it was.
    const restored = { ...installedRelease(laterRelease), environment: environment(laterRelease, { workers: 2 }) };
    const machine = await fakeHost(t, { installed: restored, kept: "linked" });
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(await machine.read(environmentFile), environment(laterRelease));
    assert.equal(await machine.read(`${environmentFile}.previous`), restored.environment);
    assert.equal(await machine.mode(`${environmentFile}.previous`), 0o600);
    assert.equal(await machine.inode(`${jarFile}.previous`), await machine.inode(jarFile));

    // The same when the stack's jar goes in over a jar that is also kept.
    const unverified = await fakeHost(t, {
      installed: { ...installedRelease(laterRelease), jar: jar("unknown", 20) }, kept: "linked"
    });
    const installed = await unverified.apply();
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(await unverified.read(jarFile), stackRelease.artifact);
    assert.equal(await unverified.read(`${jarFile}.previous`), jar("unknown", 20));
    assert.equal(await unverified.read(`${environmentFile}.previous`), environment(laterRelease));
  });

  test("leaves the host as it was when the stack artifact cannot be fetched or fails its sha256 check", async (t) => {
    const unverifiable = { ...installedRelease(laterRelease), jar: jar("unknown", 20) };
    for (const [what, installed, failure] of [
      ["missing version", unverifiable, { failing: ["s3"] }],
      ["tampered object", unverifiable, { delivered: jar("tampered", 20) }],
      ["missing version on a fresh host", null, { failing: ["s3"] }],
      ["tampered object on a fresh host", null, { delivered: jar("tampered", 20) }]
    ]) {
      const machine = await fakeHost(t, { installed });
      const before = await machine.files();
      const inodes = installed === null ? null : await machine.inodes();
      const outcome = await machine.apply(failure);
      assert.notEqual(outcome.status, 0, what);
      assert.deepEqual(await machine.files(), before, what);
      if (inodes !== null) assert.deepEqual(await machine.inodes(), inodes, what);
      assert.equal(await machine.exists(marker), false, what);
      assert.deepEqual(outcome.aws, [fetched(stackRelease)], what);
      assert.deepEqual([...outcome.agent, ...outcome.systemctl, ...outcome.curl], [], what);
      assert.deepEqual(outcome.starts, [], what);
    }
  });

  test("leaves the service's files as they were when the agent configuration is refused", async (t) => {
    for (const [what, installed] of [
      ["a kept release", { ...installedRelease(laterRelease), environment: environment(laterRelease, { workers: 2 }) }],
      ["no verified release", { ...installedRelease(laterRelease), jar: jar("unknown", 20) }]
    ]) {
      const machine = await fakeHost(t, { installed });
      const before = { files: await machine.files(), inodes: await machine.inodes() };
      const outcome = await machine.apply({ failing: ["agent"] });
      assert.notEqual(outcome.status, 0, what);
      assert.deepEqual(await machine.files(), before.files, what);
      assert.deepEqual(await machine.inodes(), before.inodes, what);
      assert.equal(await machine.exists(marker), false, what);
      assert.deepEqual(outcome.agent, [agentCall], what);
      assert.deepEqual([...outcome.systemctl, ...outcome.curl], [], what);
    }
  });

  test("restarts on the next run when a run was cut off after it replaced a file", async (t) => {
    const before = { ...installedRelease(laterRelease), environment: environment(laterRelease, { workers: 2 }) };
    const machine = await fakeHost(t, { installed: before });
    const cutOff = await machine.apply({ failing: ["daemon-reload"] });
    assert.notEqual(cutOff.status, 0);
    assert.deepEqual(cutOff.systemctl, ["daemon-reload"]);
    assert.deepEqual(cutOff.starts, []);
    // The new environment file is installed under a process that never read it.
    assert.deepEqual(await machine.files(), installedRelease(laterRelease));
    assert.deepEqual(await machine.runningFrom(), before);
    assert.equal(await machine.exists(marker), true);

    const inodes = await machine.inodes();
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.deepEqual(await machine.inodes(), inodes);
    assert.doesNotMatch(outcome.stdout, /Installed/u);
    assert.deepEqual(outcome.systemctl, withRestart);
    assert.deepEqual(outcome.starts.map((start) => start.replace(/^\d+ /u, "")), ["restart later-release"]);
    assert.deepEqual(await machine.runningFrom(), installedRelease(laterRelease));
    assert.equal(await machine.exists(marker), false);
  });

  test("still owes the restart when the restart itself fails", async (t) => {
    const before = { ...installedRelease(laterRelease), environment: environment(laterRelease, { workers: 2 }) };
    const machine = await fakeHost(t, { installed: before });
    const failed = await machine.apply({ failing: ["restart"] });
    assert.notEqual(failed.status, 0);
    assert.deepEqual(failed.systemctl, withRestart);
    assert.deepEqual([failed.starts, failed.curl], [[], []]);
    assert.deepEqual(await machine.runningFrom(), before);
    assert.equal(await machine.exists(marker), true);

    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.deepEqual(outcome.systemctl, withRestart);
    assert.deepEqual(await machine.runningFrom(), installedRelease(laterRelease));
    assert.equal(await machine.exists(marker), false);
  });

  test("fails with the unit's status when the service it restarted never answers /health", async (t) => {
    const broken = release(jar("stack-release", "never"), stackRelease.demoSha, stackRelease.eaclSha);
    const machine = await fakeHost(t);
    const outcome = await machine.apply({ stack: broken });
    assert.notEqual(outcome.status, 0);
    assert.equal(await machine.read(jarFile), broken.artifact);
    assert.deepEqual(outcome.systemctl, [...withRestart, `status ${unitName} --no-pager`]);
    assert.equal(outcome.curl.length, 180);
    assert.match(outcome.stdout, new RegExp(`${unitName}: activating \\(auto-restart\\) stack-release`, "u"));
    assert.equal(outcome.elapsed, 360);
    // The restart happened, so the next run owes none.
    assert.equal(await machine.exists(marker), false);
  });

  test("fails when a kept release is installed and not answering /health", async (t) => {
    const broken = release(jar("later-release", "never"), laterRelease.demoSha, laterRelease.eaclSha);
    const machine = await fakeHost(t, { installed: installedRelease(broken) });
    const before = { files: await machine.files(), inodes: await machine.inodes() };
    const outcome = await machine.apply();
    assert.notEqual(outcome.status, 0);
    // A release that passes its sha256 check is not replaced for being down.
    await assertUntouched(machine, outcome, before);
    assert.deepEqual(outcome.systemctl, [...withoutRestart, `status ${unitName} --no-pager`]);
    assert.match(outcome.stdout, new RegExp(`${unitName}: activating \\(auto-restart\\) later-release`, "u"));
    assert.equal(outcome.elapsed, 360);
  });
});
