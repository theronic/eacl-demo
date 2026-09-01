import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { readEaclCore } from "./eacl-core.mjs";

const EACL_JAVA_RELEASE = 25;
const EACL_CLASS_MAJOR = EACL_JAVA_RELEASE + 44;

export async function prepareLockedEaclCore(root) {
  const lock = readEaclCore(root);

  const cacheParent = path.join(root, "target", "eacl-core-source");
  const checkout = path.join(cacheParent, lock.sha);
  await mkdir(cacheParent, { recursive: true });
  if (!await exists(path.join(checkout, ".git"))) {
    await rm(checkout, { recursive: true, force: true });
    await mkdir(checkout, { recursive: true });
    run("git", ["init", "--quiet"], checkout);
    run("git", ["remote", "add", "origin", lock.repository], checkout);
    run("git", ["fetch", "--quiet", "--depth=1", "origin", lock.sha], checkout);
    run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], checkout);
  }

  const actualSha = output("git", ["rev-parse", "HEAD"], checkout);
  if (actualSha !== lock.sha) throw new Error(`cached EACL Core checkout is ${actualSha}, expected ${lock.sha}`);
  run("git", ["diff", "--quiet"], checkout);
  run("git", ["diff", "--cached", "--quiet"], checkout);

  const coreModule = path.join(checkout, "modules", "eacl");
  const datascriptModule = path.join(checkout, "modules", "eacl-datascript");
  const browserKernel = path.join(coreModule, "target", "generated", "browser", "EaclKernel.browser.js");
  // The pinned Core prep task stages browser output below modules/eacl, but
  // the JVM build copies the formal classes directly from the checkout-level
  // target. Inspect the exact source directory consumed by build.clj.
  const generatedClasses = path.join(checkout, "target", "formal", "java", "classes");
  const representativeClass = path.join(generatedClasses, "EaclKernel", "__default.class");
  if (!await exists(browserKernel) ||
      await classMajorOrNull(representativeClass) !== EACL_CLASS_MAJOR) {
    // Upstream's formal launcher accepts EACL_FORMAL_CACHE, but its Java smoke
    // compiler deliberately resolves DafnyRuntime.jar from the checkout-local
    // target/formal-tools path. Keep the whole cache in the exact checkout so
    // every pinned build script observes the same immutable source/tool root.
    run("clojure", ["-T:build", "prep"], coreModule, {
      ...process.env,
      EACL_JAVA_RELEASE: String(EACL_JAVA_RELEASE),
    });
  }
  if (!await exists(browserKernel)) throw new Error("the pinned EACL Core prep task did not produce EaclKernel.browser.js");
  const classFiles = await filesBelow(generatedClasses, ".class");
  if (classFiles.length === 0) {
    throw new Error("the pinned EACL Core prep task produced no generated Java classes");
  }
  for (const classFile of classFiles) {
    const major = await classMajorOrNull(classFile);
    if (major !== EACL_CLASS_MAJOR) {
      throw new Error(`generated EACL class ${path.relative(generatedClasses, classFile)} has classfile major ${major ?? "invalid"}; expected ${EACL_CLASS_MAJOR} for Java ${EACL_JAVA_RELEASE}`);
    }
  }

  return Object.freeze({ lock, checkout, coreModule, datascriptModule,
    browserKernel, generatedClasses, javaRelease: EACL_JAVA_RELEASE,
    classMajor: EACL_CLASS_MAJOR });
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
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}
