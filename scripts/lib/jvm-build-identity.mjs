import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const JVM_BUILD_IDENTITY_RESOURCE = "META-INF/eacl-demo/build-identity.v1.json";

export async function loadLockedJvmBuildIdentity(root) {
  const lock = JSON.parse(await readFile(path.join(root, "dependencies", "eacl-core.lock.json"), "utf8"));
  if (lock?.schema !== "eacl-demo.eacl-core-lock.v1" ||
      !/^[0-9a-f]{40}$/u.test(lock.sha ?? "")) {
    throw new Error("the EACL Core lock cannot establish a JVM build identity");
  }
  return Object.freeze({
    schema: "eacl-demo.jvm-build-identity.v1",
    eaclSha: lock.sha
  });
}

export async function writeJvmBuildIdentity(root, classDirectory) {
  const identity = await loadLockedJvmBuildIdentity(root);
  const target = path.join(classDirectory, ...JVM_BUILD_IDENTITY_RESOURCE.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(identity)}\n`, { encoding: "utf8", mode: 0o644 });
  return identity;
}

export function readJvmBuildIdentityFromJar(archive) {
  const source = execFileSync("unzip", ["-p", archive, JVM_BUILD_IDENTITY_RESOURCE], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"]
  });
  const identity = JSON.parse(source);
  if (JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(["eaclSha", "schema"]) ||
      identity.schema !== "eacl-demo.jvm-build-identity.v1" ||
      !/^[0-9a-f]{40}$/u.test(identity.eaclSha ?? "")) {
    throw new Error("the JAR contains an invalid JVM build identity");
  }
  return identity;
}
