import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readEaclCore } from "./eacl-core.mjs";

export const JVM_BUILD_IDENTITY_RESOURCE = "META-INF/eacl-demo/build-identity.v1.json";

export async function loadLockedJvmBuildIdentity(root) {
  return Object.freeze({
    schema: "eacl-demo.jvm-build-identity.v1",
    eaclSha: readEaclCore(root).sha
  });
}

export async function writeJvmBuildIdentity(root, classDirectory) {
  const identity = await loadLockedJvmBuildIdentity(root);
  const target = path.join(classDirectory, ...JVM_BUILD_IDENTITY_RESOURCE.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(identity)}\n`, { encoding: "utf8", mode: 0o644 });
  return identity;
}
