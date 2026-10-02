import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pomScmTag, readEaclRelease } from "./eacl-core.mjs";

// The published dev.eacl/eacl JAR carries EACL's generated Java kernel and
// its browser build (EaclKernel.browser.js, declared by the JAR's deps.cljs).
// Every one of its classes must load on the pinned Java 25 runtime.
const REQUIRED_CLASS_MAJOR = 69;

export async function prepareLockedEaclCore(root) {
  const release = readEaclRelease(root);
  const lock = Object.freeze({
    repository: release.repository,
    sha: release.sha,
    modules: release.modules,
  });

  const coreJar = publishedCoreJar(root, release.version);
  const tag = pomScmTag(output("unzip", ["-p", coreJar, "META-INF/maven/dev.eacl/eacl/pom.xml"], root));
  if (tag !== release.sha) {
    throw new Error(`dev.eacl/eacl ${release.version} was published from ${tag ?? "an unrecorded commit"}, but deps.edn names EACL source commit ${release.sha}`);
  }
  await verifyClassMajors(coreJar, release.version);

  // eacl-datalevin is unpublished, so it builds from the release's source
  // commit. The published JAR supplies everything else.
  const cacheParent = path.join(root, "target", "eacl-core-source");
  const checkout = path.join(cacheParent, release.sha);
  await mkdir(cacheParent, { recursive: true });
  if (!await exists(path.join(checkout, ".git"))) {
    await rm(checkout, { recursive: true, force: true });
    await mkdir(checkout, { recursive: true });
    run("git", ["init", "--quiet"], checkout);
    run("git", ["remote", "add", "origin", release.repository], checkout);
    run("git", ["fetch", "--quiet", "--depth=1", "origin", release.sha], checkout);
    run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], checkout);
  }
  const actualSha = output("git", ["rev-parse", "HEAD"], checkout).trim();
  if (actualSha !== release.sha) throw new Error(`cached EACL source checkout is ${actualSha}, expected ${release.sha}`);
  run("git", ["diff", "--quiet"], checkout);
  run("git", ["diff", "--cached", "--quiet"], checkout);

  return Object.freeze({ lock, release, coreJar, checkout });
}

// Resolves the published core JAR through tools.deps, so it is the exact file
// every alias's classpath uses.
function publishedCoreJar(root, version) {
  const classpath = output("clojure", [
    "-Sdeps", `{:deps {dev.eacl/eacl {:mvn/version ${JSON.stringify(version)}}}}`,
    "-Spath"
  ], root).trim();
  const suffix = `${path.sep}eacl-${version}.jar`;
  const jar = classpath.split(path.delimiter).find((entry) => entry.endsWith(suffix) &&
    entry.includes(`${path.sep}dev${path.sep}eacl${path.sep}eacl${path.sep}${version}${path.sep}`));
  if (!jar) throw new Error(`tools.deps did not resolve dev.eacl/eacl ${version}`);
  return jar;
}

async function verifyClassMajors(coreJar, version) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-core-classes-"));
  try {
    execFileSync("unzip", ["-q", "-o", coreJar, "*.class", "-d", temporary], { stdio: "inherit" });
    const classFiles = await filesBelow(temporary, ".class");
    if (!classFiles.some((file) => file.endsWith(path.join("EaclKernel", "__default.class")))) {
      throw new Error(`dev.eacl/eacl ${version} does not contain the generated EACL kernel`);
    }
    for (const classFile of classFiles) {
      const major = await classMajorOrNull(classFile);
      if (major !== REQUIRED_CLASS_MAJOR) {
        throw new Error(`dev.eacl/eacl ${version} class ${path.relative(temporary, classFile)} has classfile major ${major ?? "invalid"}; expected ${REQUIRED_CLASS_MAJOR} for the Java 25 runtime`);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, {
    cwd,
    env,
    stdio: "inherit"
  });
}

async function classMajorOrNull(classFile) {
  try {
    const bytes = await readFile(classFile);
    if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0xcafebabe) return null;
    return bytes.readUInt16BE(6);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function filesBelow(directory, suffix) {
  if (!await exists(directory)) return [];
  const result = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name.endsWith(suffix)) result.push(candidate);
    }
  }
  return result.sort();
}

function output(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
