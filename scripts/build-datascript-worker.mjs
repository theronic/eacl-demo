import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { prepareLockedEaclCore } from "./lib/prepare-eacl-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist", "datascript-worker");
const compilerOutput = path.join(root, "target", "datascript-worker", "cljs-out");
const output = path.join(target, "datascript-worker.js");
const prepared = await prepareLockedEaclCore(root);
const buildUnits = JSON.parse(await readFile(path.join(root, "build-units.json"), "utf8"));
const unit = buildUnits.units?.["datascript-worker"];
if (!unit || unit.deploymentTrack === "parked" && unit.deploymentEligible === true) throw new Error("DataScript worker build-unit state is invalid");

await rm(target, { recursive: true, force: true });
await rm(compilerOutput, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await mkdir(compilerOutput, { recursive: true });

const override = `{:override-deps {dev.eacl/eacl-datascript {:local/root ${ednString(prepared.datascriptModule)}}}}`;
const compilerOptions = `{:closure-defines {eacl-demo.datascript.worker/core-sha ${ednString(prepared.lock.sha)}}}`;
execFileSync("clojure", [
  "-Sdeps", override,
  "-M:datascript-worker",
  "-m", "cljs.main",
  "-t", "webworker",
  "-O", "advanced",
  "-co", compilerOptions,
  "--output-dir", compilerOutput,
  "-o", output,
  "-c", "eacl-demo.datascript.worker"
], { cwd: root, stdio: "inherit" });

const bytes = await readFile(output);
if (!bytes.includes(Buffer.from(prepared.lock.sha, "utf8"))) throw new Error("compiled DataScript worker does not contain the locked EACL Core SHA");
if (bytes.includes(Buffer.from("0000000000000000000000000000000000000000", "utf8"))) throw new Error("compiled DataScript worker retained the unconfigured EACL Core identity");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schemaVersion: 1,
  unit: "datascript-worker",
  kind: "browser-worker",
  runtime: "clojurescript-webworker",
  entryNamespace: "eacl-demo.datascript.worker",
  adapter: "dev.eacl/eacl-datascript",
  eaclCoreSha: prepared.lock.sha,
  artifact: { path: "datascript-worker.js", sha256, bytes: bytes.length },
  deploymentEligible: unit.deploymentEligible,
  qualificationState: unit.deploymentTrack === "parked" ? "parked" : unit.deploymentEligible ? "eligible" : "foundation-only"
};
await writeFile(path.join(target, "artifact.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`datascript-worker\tsha256:${sha256}\t${bytes.length} bytes\tEACL ${prepared.lock.sha}`);

function ednString(value) {
  return JSON.stringify(value);
}
