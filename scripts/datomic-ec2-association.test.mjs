import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, constants, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const template = await readFile(new URL("../infra/profiles/datomic-dynamodb-ec2.yaml", import.meta.url), "utf8");

const region = "us-east-1";
const bucket = "eacl-demo-artifacts";
const cursorKey = "c".repeat(64);
const epoch = 1_800_000_000;
const unitName = "eacl-demo-datomic.service";
const jarFile = "/opt/eacl-demo/function.jar";
const environmentFile = "/etc/eacl-demo-datomic.env";
const unitFile = `/etc/systemd/system/${unitName}`;
const releaseFile = "/etc/eacl-demo-release.env";
const marker = "/etc/eacl-demo-keep-release";
const memoryFile = "/proc/meminfo";
const fixedHeap = "-Xms1024m -Xmx1024m -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError -Ddatomic.objectCacheMax=576m";
const smallHeap = "-Xms384m -Xmx640m -XX:+ExitOnOutOfMemoryError";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// A host that exists only under a temporary directory. Paths the association
// names under these three directories are moved there.
const hostPath = /(?<![\w.-])\/(?:opt|etc|proc)\//gu;
// The association runs on the machine that runs this test, so it must name no
// other path of that machine. Apart from one device and the java binary the
// unit names, every absolute path it names lies under a directory that is
// moved. Two matches are not paths: an awk pattern and the end of a sed
// address.
const elsewhere = new Set(["/dev/null", "/usr/bin/java", "/MemTotal/", "/d"]);
const pathsNamed = (text) => text.match(/(?<![\w.\/}-])\/[A-Za-z][\w.\/-]*/gu) ?? [];
const outsideFakeHost = (text) => pathsNamed(text)
  .filter((named) => !elsewhere.has(named) && named.replace(hostPath, "") === named);

// A fake jar describes the service it would run: its name, then how many
// seconds after a start it begins to answer /health. `never` is a jar that
// cannot start.
const jar = (name, startup) => `${name}\n${startup}\n`;
const release = (artifact, demoSha, eaclSha) => ({
  artifact, artifactSha256: sha256(artifact), demoSha, eaclSha,
  deploymentId: `production:${demoSha}:datomic-dynamodb`
});
// What the stack's parameters name, and two releases that reached the host
// over SSM afterwards: one from a later commit that built the same jar, and
// one with a jar of its own.
const stackRelease = release(jar("stack-release", 20), "a".repeat(40), "b".repeat(40));
const sameJarRelease = release(stackRelease.artifact, "d".repeat(40), stackRelease.eaclSha);
const laterRelease = release(jar("later-release", 20), "d".repeat(40), "e".repeat(40));

const parameters = {
  ArtifactBucket: bucket,
  ArtifactKey: `artifacts/datomic-dynamodb/${stackRelease.demoSha}/${stackRelease.artifactSha256}.jar`,
  ArtifactVersion: "object-version-1",
  ArtifactSha256: stackRelease.artifactSha256,
  DemoSha: stackRelease.demoSha,
  EaclSha: stackRelease.eaclSha,
  DeploymentId: stackRelease.deploymentId
};

// The association is a list of commands, written as plain, double-quoted and
// folded scalars, some of them under !Sub. YAML gives each item its text,
// CloudFormation replaces each ${Name} in the !Sub items and in no other, and
// SSM writes the items to one script, a command to a line, which the host
// runs with sh. Nothing stops that script at a command that fails.
const resource = /\n  RuntimeArtifactAssociation:\n[\s\S]*?(?=\n  \S)/u.exec(template)?.[0];
assert.ok(resource, "the template no longer declares RuntimeArtifactAssociation");
const commands = (() => {
  const lines = resource.split("\n");
  const items = [];
  let index = lines.indexOf("        commands:") + 1;
  assert.ok(index > 0, "the association no longer lists its commands");
  while (index < lines.length) {
    const line = lines[index];
    index += 1;
    if (line.trim() === "" || /^ {10}#/u.test(line)) continue;
    const item = /^ {10}- (!Sub )?(.+)$/u.exec(line);
    assert.ok(item, `the association holds a line this test does not read: ${line}`);
    const [, sub, written] = item;
    let text;
    if (written === ">-") {
      // A folded scalar: its lines are joined by single spaces.
      const folded = [];
      for (; /^ {12}\S/u.test(lines[index] ?? ""); index += 1) folded.push(lines[index].slice(12));
      assert.ok(folded.length > 0, "a folded command has no text");
      text = folded.join(" ");
    } else if (written.startsWith('"')) {
      assert.match(written, /^"(?:[^"\\]|\\[\\"])*"$/u, `a quoted command uses an escape this test does not read: ${written}`);
      text = written.slice(1, -1).replace(/\\([\\"])/gu, "$1");
    } else {
      assert.doesNotMatch(written, /^[!&*'|>%@`{[#-]|: | #/u, `not a plain scalar: ${written}`);
      text = written;
    }
    items.push({ sub: sub !== undefined, text });
  }
  return items;
})();
const script = `${commands.map(({ sub, text }) => !sub ? text : text.replace(/\$\{([^}]*)\}/gu, (reference, name) => {
  assert.ok(name in parameters, `the test supplies no value for ${reference}`);
  return parameters[name];
})).join("\n")}\n`;

// The unit as first boot writes it, and the environment file as first boot
// and the release command leave it.
const unit = /<<'SERVICE'\n([\s\S]*?\n) *SERVICE\n/u.exec(template)?.[1].replace(/^ {10}/gmu, "");
assert.ok(unit, "first boot no longer writes the unit from a SERVICE here-document");
const environment = ({ artifactSha256, eaclSha, demoSha, deploymentId },
  { concurrency = 4, workers = [], memory = 2048, options = fixedHeap } = {}) => `${[
  `AWS_REGION=${region}`,
  "AWS_LAMBDA_FUNCTION_NAME=eacl-demo-datomic-dynamodb-ec2",
  `EACL_ARTIFACT_SHA256=${artifactSha256}`,
  `EACL_CORE_SHA=${eaclSha}`,
  `EACL_CURSOR_KEY=${cursorKey}`,
  "EACL_DATOMIC_DATABASE=eacl-demo",
  "EACL_DATOMIC_TABLE=eacl-demo-datomic-fixture-v8",
  `EACL_DEMO_SHA=${demoSha}`,
  `EACL_DEPLOYMENT_ID=${deploymentId}`,
  "EACL_HTTP_PORT=8080",
  ...workers,
  `EACL_MAXIMUM_CONCURRENCY=${concurrency}`,
  "EACL_RUNTIME_EXECUTION=ec2",
  `EACL_RUNTIME_MEMORY_MIB=${memory}`,
  ...(options === null ? [] : [`EACL_JAVA_OPTS=${options}`])
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "eacl-datomic-association-tools-"));
  assert.match(directory, /^[\w/.-]+$/u, "the temporary directory must not need shell quoting");
  const bash = await onPath("bash");
  assert.ok(bash, "bash is not on PATH");
  await symlink(bash, path.join(directory, "sh"));
  for (const name of ["seq", "grep", "awk", "install", "touch", "rm"]) {
    const tool = await onPath(name);
    assert.ok(tool, `${name} is not on PATH`);
    await symlink(tool, path.join(directory, name));
  }
  const probe = path.join(directory, "probe");
  const wrapper = async (name, body) => {
    await writeFile(path.join(directory, name), `#!${bash}\n${body}\n`);
    await chmod(path.join(directory, name), 0o755);
  };
  // The host has GNU sha256sum. Where the local one cannot check a digest
  // line the same way, shasum takes the same flags and prints the same lines.
  await writeFile(probe, "probe");
  const checks = async (tool) => tool !== null && (await run(bash, ["-c",
    `echo '${sha256("probe")}  ${probe}' | ${tool} --check --strict --status && ` +
    `! echo '${sha256("other")}  ${probe}' | ${tool} --check --strict --status && ` +
    `! printf '%s\\n' not-a-digest '${sha256("probe")}  ${probe}' | ${tool} --check --strict --status`])).status === 0;
  const sha256sum = await onPath("sha256sum");
  if (await checks(sha256sum)) {
    await symlink(sha256sum, path.join(directory, "sha256sum"));
  } else {
    const shasum = await onPath("shasum");
    assert.ok(await checks(shasum === null ? null : `${shasum} -a 256`),
      "neither sha256sum nor shasum can check a digest here");
    await wrapper("sha256sum", `exec ${shasum} -a 256 "$@"`);
  }
  // The host has GNU sed, whose -i takes no argument. Where the local one
  // wants a backup suffix after -i, it is given an empty one.
  const sed = await onPath("sed");
  assert.ok(sed, "sed is not on PATH");
  const edits = async (tool) => {
    await writeFile(probe, "before\n");
    return (await run(tool, ["-i", "s|^before$|after|", probe])).status === 0 &&
      await readFile(probe, "utf8") === "after\n";
  };
  if (await edits(sed)) {
    await symlink(sed, path.join(directory, "sed"));
  } else {
    await wrapper("sed", `if [ "$1" = -i ]; then shift; exec ${sed} -i '' "$@"; fi\nexec ${sed} "$@"`);
    assert.ok(await edits(path.join(directory, "sed")), "sed cannot edit a file in place here");
  }
  await rm(probe);
  const noOp = await onPath("true");
  assert.ok(noOp, "true is not on PATH");
  return { directory, noOp };
}

// EACL_ASSOCIATION_IMAGE runs the association with the shell and the tools of
// a container image instead of the local ones. The host runs Amazon Linux 2023:
//   EACL_ASSOCIATION_IMAGE=public.ecr.aws/amazonlinux/amazonlinux:2023 node --test scripts/datomic-ec2-association.test.mjs
const image = process.env.EACL_ASSOCIATION_IMAGE || null;
const skip = process.platform === "win32" ? "the association needs a POSIX shell" : false;
const tools = skip ? null : image === null ? await toolDirectory() : { directory: null, noOp: "/usr/bin/true" };
after(async () => {
  if (tools?.directory) await rm(tools.directory, { recursive: true, force: true });
});

const healthPoll = "--fail --silent -H x-eacl-request-id: ec2-artifact-health http://127.0.0.1:8080/health";

// Stand-ins for the commands that would reach AWS, systemd, the service and
// the clock. The script sources them before the association's commands, so
// each is a function of the shell that runs it: a poll costs no process, and
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
    // When the running service starts to answer /health. systemd starts the
    // unit it loaded last, and the reader refuses an environment that lacks
    // what parse-environment in lambda_handler.clj requires.
    "answers_from() {",
    "  local name startup started pattern",
    `  { read -r name && read -r startup; } < ${state}/running.jar || { echo never; return 0; }`,
    `  [ "$startup" != never ] || { echo never; return 0; }`,
    `  grep -Fqx -- "EnvironmentFile=${liveEnvironment}" ${state}/running.unit || { echo never; return 0; }`,
    `  grep -Fqx -- 'ExecStart=/usr/bin/java $EACL_JAVA_OPTS -cp ${liveJar} clojure.main -m eacl-demo.datomic-dynamodb.http-server' ${state}/running.unit || { echo never; return 0; }`,
    "  for pattern in 'AWS_REGION=.+' 'EACL_DATOMIC_TABLE=.+' 'EACL_DATOMIC_DATABASE=.+' \\",
    "      'EACL_DEMO_SHA=[0-9a-f]{40}' 'EACL_ARTIFACT_SHA256=[0-9a-f]{64}' \\",
    "      'EACL_DEPLOYMENT_ID=[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}' 'EACL_CURSOR_KEY=.+' \\",
    "      'EACL_MAXIMUM_CONCURRENCY=[1-9][0-9]{0,8}' 'EACL_RUNTIME_MEMORY_MIB=[1-9][0-9]{0,8}' \\",
    "      'EACL_RUNTIME_EXECUTION=ec2' 'EACL_HTTP_PORT=8080'; do",
    `    grep -Eqx -- "$pattern" ${state}/running.env || { echo never; return 0; }`,
    "  done",
    `  read -r started < ${state}/started`,
    "  echo $((started + startup))",
    "}",
    "answers() {",
    "  local from clock",
    `  [ -e ${state}/answers-from ] || answers_from > ${state}/answers-from`,
    `  read -r from < ${state}/answers-from`,
    `  read -r clock < ${state}/clock`,
    `  [ "$from" != never ] && [ "$clock" -ge "$from" ]`,
    "}",
    "sleep() {",
    "  local clock",
    `  read -r clock < ${state}/clock`,
    `  echo "$((clock + $1))" > ${state}/clock`,
    "}",
    "aws() {",
    `  echo "aws $*" >> ${state}/calls`,
    `  [ "$1 $2" = "s3api get-object" ] || { unexpected aws "$@"; return 64; }`,
    // The object is written to the last argument.
    "  local outfile",
    "  for outfile; do :; done",
    `  echo "$(<${state}/artifact)" > "$outfile"`,
    `  echo '{"VersionId": "object-version-1"}'`,
    "}",
    "systemctl() {",
    `  echo "systemctl $*" >> ${state}/calls`,
    "  local name clock",
    `  case "$*" in`,
    "    daemon-reload)",
    `      echo "$(<${liveUnit})" > ${state}/loaded.unit`,
    "      ;;",
    // Starts the service from what is installed and what systemd has loaded.
    `    "restart ${unitName}")`,
    `      if [ -e ${liveJar} ]; then echo "$(<${liveJar})" > ${state}/running.jar; else : > ${state}/running.jar; fi`,
    `      echo "$(<${liveEnvironment})" > ${state}/running.env`,
    `      echo "$(<${state}/loaded.unit)" > ${state}/running.unit`,
    `      read -r clock < ${state}/clock`,
    `      echo "$clock" > ${state}/started`,
    `      rm -f ${state}/answers-from`,
    `      read -r name < ${state}/running.jar || name=nothing`,
    `      echo "$((clock - ${epoch})) $name" >> ${state}/starts`,
    "      ;;",
    `    *) unexpected systemctl "$@"; return 64 ;;`,
    "  esac",
    "}",
    "curl() {",
    `  echo "curl $*" >> ${state}/calls`,
    `  [ "$*" = "${healthPoll}" ] || { unexpected curl "$@"; return 64; }`,
    "  answers || return 7",
    `  echo '{"data":{"status":"ready","ready":true}}'`,
    "}"
  ].join("\n")}\n`;
}

async function fakeHost(t, {
  // The jar, environment file and unit on disk. The association waits for
  // first boot to write them, so a host always has them: by default the
  // stack's own release, as first boot installs it.
  installed = installedRelease(stackRelease),
  // What /proc/meminfo reports, in kB: a 2 GiB host by default.
  memory = 1_949_432,
  // The marker of an earlier run that kept a release.
  marked = false
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "eacl-datomic-association-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.match(root, /^[\w/.-]+$/u, "the temporary directory must not need shell quoting");
  const at = (file) => `${root}${file}`;
  const onHost = (text) => text.replace(hostPath, (directory) => `${root}${directory}`);
  const state = at("/state");
  for (const directory of [
    "/state", "/proc", "/opt/eacl-demo", "/etc/systemd/system",
    "/opt/aws/amazon-cloudwatch-agent/etc", "/opt/aws/amazon-cloudwatch-agent/bin"
  ]) {
    await mkdir(at(directory), { recursive: true });
  }
  const place = async (file, text, mode) => {
    await writeFile(at(file), text);
    await chmod(at(file), mode);
  };
  if (installed.jar !== null) await place(jarFile, installed.jar, 0o644);
  await place(environmentFile, onHost(installed.environment), 0o600);
  await place(unitFile, onHost(installed.unit), 0o644);
  await place(memoryFile, `MemTotal:        ${memory} kB\nMemFree:          123456 kB\n`, 0o444);
  if (marked) await place(marker, "", 0o644);

  await writeFile(`${state}/clock`, `${epoch}\n`);
  await writeFile(`${state}/calls`, "");
  await writeFile(`${state}/starts`, "");
  // systemd loaded the installed unit at boot, and the service that is
  // running started from the installed files long ago.
  await writeFile(`${state}/loaded.unit`, onHost(installed.unit));
  await writeFile(`${state}/started`, `${epoch - 86_400}\n`);
  await writeFile(`${state}/running.jar`, installed.jar ?? "");
  await writeFile(`${state}/running.env`, onHost(installed.environment));
  await writeFile(`${state}/running.unit`, onHost(installed.unit));
  // S3 holds the stack's artifact under the stack's key and version.
  await writeFile(`${state}/artifact`, stackRelease.artifact);
  await writeFile(`${state}/stand-ins.sh`, standIns({ root, state }));
  // The agent's control command is called by its path, and the association
  // goes on whatever that command answers, so `true` stands in for it.
  await symlink(tools.noOp, at("/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl"));

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

  // Runs the association the way the SSM agent does, as an sh script, with the
  // stand-ins defined first.
  async function apply() {
    assert.deepEqual(outsideFakeHost(script), [], "the association names a path outside the fake host, so it is not run");
    await writeFile(at("/_script.sh"), `. ${state}/stand-ins.sh\n${onHost(script)}`);
    const { status, stdout, stderr } = image === null
      ? await run(path.join(tools.directory, "sh"), ["_script.sh"], { cwd: root, env: { PATH: tools.directory } })
      : await run("docker", ["run", "--rm", "--network", "none", "--volume", `${root}:${root}`, "--workdir", root,
        "--env", "PATH=/usr/bin:/bin", image, "sh", "_script.sh"]);

    assert.equal(await exists("/state/unexpected"), false, `${stdout}${stderr}`);
    // Whatever happened, the environment file is still private and nothing
    // printed carries the cursor key.
    assert.equal((await stat(at(environmentFile))).mode & 0o777, 0o600);
    assert.equal(`${stdout}${stderr}`.includes(cursorKey), false, "the association printed the cursor key");
    const calls = (await lines("calls")).map((call) => call.replaceAll(root, ""));
    const made = (command) => calls.filter((call) => call.startsWith(`${command} `)).map((call) => call.slice(command.length + 1));
    return {
      status, stderr: stderr.replaceAll(root, ""),
      aws: made("aws"), systemctl: made("systemctl"), curl: made("curl"),
      // Each start of the service: seconds into the run, and which jar.
      starts: await lines("starts"),
      elapsed: Number(await readFile(`${state}/clock`, "utf8")) - epoch
    };
  }

  return {
    apply, read, exists,
    inode: async (file) => (await stat(at(file))).ino,
    // What the service process is running from.
    runningFrom: async () => ({
      jar: await read("/state/running.jar"), environment: await read("/state/running.env"), unit: await read("/state/running.unit")
    }),
    files: async () => ({ jar: await read(jarFile), environment: await read(environmentFile), unit: await read(unitFile) })
  };
}

const fetched =
  `s3api get-object --region ${region} --bucket ${bucket} --key ${parameters.ArtifactKey} --version-id ${parameters.ArtifactVersion} ${jarFile}.next`;
const restart = ["daemon-reload", `restart ${unitName}`];

// A kept release: nothing was fetched, the jar is the file it was, and the
// run ends with the marker in place. The service is restarted all the same.
async function assertKept(machine, outcome, jarInode) {
  assert.deepEqual(outcome.aws, []);
  assert.equal(await machine.inode(jarFile), jarInode, "the jar was replaced");
  assert.equal(await machine.exists(`${jarFile}.next`), false);
  assert.equal(await machine.exists(marker), true);
  assert.deepEqual(outcome.systemctl, restart);
}

test("the association's commands name only the stack's own parameters", () => {
  const declared = [...(/\nParameters:\n([\s\S]*?)\nResources:\n/u.exec(template)?.[1] ?? "").matchAll(/^ {2}(\w+):/gmu)]
    .map((match) => match[1]);
  assert.ok(declared.includes("ArtifactSha256"));
  for (const { sub, text } of commands) {
    const named = [...text.matchAll(/\$\{([^}]*)\}/gu)].map((match) => match[1]);
    if (sub) {
      // CloudFormation rejects a template whose !Sub names anything else, and
      // a shell ${variable} would be read as such a name.
      assert.ok(named.length > 0, `!Sub has nothing to replace in: ${text}`);
      for (const name of named) assert.ok(declared.includes(name), `\${${name}} is not a parameter of the template`);
    } else {
      // Outside !Sub nothing is replaced: the host's shell would expand a
      // parameter's name to nothing.
      assert.deepEqual(named, [], text);
    }
  }
  for (const name of Object.keys(parameters)) {
    assert.ok(commands.some(({ sub, text }) => sub && text.includes(`\${${name}}`)), `the association no longer uses ${name}`);
  }
});

test("the fake host stands in for every path the association names", () => {
  const paths = pathsNamed(script);
  for (const file of [jarFile, `${jarFile}.next`, environmentFile, unitFile, releaseFile, marker, memoryFile]) {
    assert.ok(paths.includes(file), file);
  }
  assert.deepEqual(outsideFakeHost(script), []);
  assert.deepEqual(new Set(paths.filter((named) => elsewhere.has(named))), elsewhere);
});

describe("Datomic EC2 runtime artifact association", { concurrency: image === null, skip }, () => {
  test("keeps the release that first boot installed, without fetching it again", async (t) => {
    const machine = await fakeHost(t);
    const before = { files: await machine.files(), jarInode: await machine.inode(jarFile) };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    await assertKept(machine, outcome, before.jarInode);
    assert.deepEqual(await machine.files(), before.files);
    assert.deepEqual(before.files, installedRelease(stackRelease));
    // The stack's artifact is recorded for the fetch that did not happen.
    assert.equal(await machine.read(releaseFile), [
      `ARTIFACT_BUCKET=${bucket}`,
      `ARTIFACT_KEY=${parameters.ArtifactKey}`,
      `ARTIFACT_VERSION=${parameters.ArtifactVersion}`,
      `ARTIFACT_SHA256=${stackRelease.artifactSha256}`,
      ""
    ].join("\n"));
    assert.deepEqual(outcome.starts, ["0 stack-release"]);
    assert.ok(outcome.curl.length > 2);
    for (const poll of outcome.curl) assert.equal(poll, healthPoll);
    assert.ok(outcome.elapsed >= 20 && outcome.elapsed <= 22, `took ${outcome.elapsed} s`);
  });

  test("keeps a release from a later commit that built the stack's own jar", async (t) => {
    // The stack's sha256 is installed, under a later commit and deployment.
    // Writing the stack's release lines here would put the host back on a
    // commit the registry no longer names, and the Explorer would refuse it.
    const machine = await fakeHost(t, { installed: installedRelease(sameJarRelease) });
    const before = { files: await machine.files(), jarInode: await machine.inode(jarFile) };
    assert.equal(sameJarRelease.artifactSha256, stackRelease.artifactSha256);
    assert.notEqual(environment(sameJarRelease), environment(stackRelease));
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.deepEqual(await machine.files(), before.files);
    assert.deepEqual(before.files, installedRelease(sameJarRelease));
    await assertKept(machine, outcome, before.jarInode);
    // The restarted service answers as the later commit's release.
    assert.deepEqual(await machine.runningFrom(), installedRelease(sameJarRelease));
  });

  test("keeps a newer verified release", async (t) => {
    const machine = await fakeHost(t, { installed: installedRelease(laterRelease) });
    const before = { files: await machine.files(), jarInode: await machine.inode(jarFile) };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 0, outcome.stderr);
    await assertKept(machine, outcome, before.jarInode);
    assert.deepEqual(await machine.files(), before.files);
    assert.deepEqual(before.files, installedRelease(laterRelease));
    assert.deepEqual(outcome.starts, ["0 later-release"]);
    assert.deepEqual(await machine.runningFrom(), installedRelease(laterRelease));
  });

  test("installs the stack's release when the installed jar is not the one the environment file names", async (t) => {
    for (const [what, installedJar] of [["another jar", jar("unknown", 20)], ["no jar", null]]) {
      // An earlier run kept a release here; this run decides for itself.
      const machine = await fakeHost(t, { installed: { ...installedRelease(laterRelease), jar: installedJar }, marked: true });
      const outcome = await machine.apply();
      assert.equal(outcome.status, 0, `${what}: ${outcome.stderr}`);
      // The host keeps its cursor key, so cursors it issued stay valid.
      const files = installedRelease(stackRelease);
      assert.deepEqual(await machine.files(), files, what);
      assert.equal(await machine.exists(marker), false, what);
      assert.deepEqual(outcome.aws, [fetched], what);
      assert.deepEqual(outcome.systemctl, restart, what);
      assert.deepEqual(outcome.starts, ["0 stack-release"], what);
      assert.deepEqual(await machine.runningFrom(), files, what);
    }
  });

  test("installs the stack's release when the environment file does not name one sha256", async (t) => {
    const whole = environment(laterRelease);
    const named = `EACL_ARTIFACT_SHA256=${laterRelease.artifactSha256}\n`;
    const stackNamed = `EACL_ARTIFACT_SHA256=${stackRelease.artifactSha256}\n`;
    for (const [what, damaged, repaired] of [
      ["an empty line", whole.replace(named, "EACL_ARTIFACT_SHA256=\n"), environment(stackRelease)],
      ["a repeated line", `${whole}${named}`, `${environment(stackRelease)}${stackNamed}`]
    ]) {
      assert.notEqual(damaged, whole, what);
      // The jar is the later release's own; only the line that names it is damaged.
      const machine = await fakeHost(t, { installed: { ...installedRelease(laterRelease), environment: damaged } });
      const outcome = await machine.apply();
      assert.equal(outcome.status, 0, `${what}: ${outcome.stderr}`);
      assert.deepEqual(await machine.files(), { jar: stackRelease.artifact, environment: repaired, unit }, what);
      assert.equal(await machine.exists(marker), false, what);
      assert.deepEqual(outcome.aws, [fetched], what);
      assert.deepEqual(outcome.starts, ["0 stack-release"], what);
    }
  });

  test("applies the template's host settings to a kept release and leaves its release lines alone", async (t) => {
    const olderUnit = unit.replace("ExecStart=/usr/bin/java $EACL_JAVA_OPTS -cp", "ExecStart=/usr/bin/java -Xms384m -Xmx640m -cp");
    assert.notEqual(olderUnit, unit);
    const older = { concurrency: 1, workers: ["EACL_HTTP_WORKERS=4"], memory: 512, options: null };
    for (const [what, memory, settings] of [
      ["a 2 GiB host", 1_949_432, {}],
      ["a 1 GiB host", 949_432, { memory: 1024, options: smallHeap }]
    ]) {
      const machine = await fakeHost(t, {
        installed: { ...installedRelease(laterRelease, older), unit: olderUnit }, memory
      });
      const jarInode = await machine.inode(jarFile);
      const outcome = await machine.apply();
      assert.equal(outcome.status, 0, `${what}: ${outcome.stderr}`);
      await assertKept(machine, outcome, jarInode);
      // The release lines and the cursor key stay; the rest is the template's.
      const files = installedRelease(laterRelease, settings);
      assert.deepEqual(await machine.files(), files, what);
      // The health wait was answered by a process started from these files.
      assert.deepEqual(await machine.runningFrom(), files, what);
      assert.deepEqual(outcome.starts, ["0 later-release"], what);
    }
  });

  test("fails when a kept release does not answer /health after the restart", async (t) => {
    const broken = release(jar("later-release", "never"), laterRelease.demoSha, laterRelease.eaclSha);
    const machine = await fakeHost(t, { installed: installedRelease(broken) });
    const before = { files: await machine.files(), jarInode: await machine.inode(jarFile) };
    const outcome = await machine.apply();
    assert.equal(outcome.status, 1);
    // A release that passes its sha256 check is not replaced for being down.
    await assertKept(machine, outcome, before.jarInode);
    assert.deepEqual(await machine.files(), before.files);
    assert.equal(outcome.curl.length, 180);
    assert.equal(outcome.elapsed, 360);
  });
});
