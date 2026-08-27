import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { prepareLockedEaclCore } from "./lib/prepare-eacl-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist", "datascript-runtime");
const compilerOutput = path.join(root, "target", "datascript-runtime", "cljs-out");
const snapshotOutput = path.join(root, "target", "datascript-runtime", "datascript-snapshot.json");
const output = path.join(target, "datascript-runtime.js");
const prepared = await prepareLockedEaclCore(root);
const buildUnits = JSON.parse(await readFile(path.join(root, "build-units.json"), "utf8"));
const unit = buildUnits.units?.["datascript-runtime"];
if (!unit || unit.deploymentTrack === "parked" && unit.deploymentEligible === true) throw new Error("DataScript runtime build-unit state is invalid");

await rm(target, { recursive: true, force: true });
await rm(compilerOutput, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await mkdir(compilerOutput, { recursive: true });

const override = `{:paths ["packages/contracts/src" "packages/fixture-types/src" ${ednString(prepared.generatedClasses)}] :deps {org.clojure/data.json {:mvn/version "2.5.2"}} :override-deps {dev.eacl/eacl-datascript {:local/root ${ednString(prepared.datascriptModule)}}}}`;
const compilerOptions = `{:closure-defines {eacl-demo.datascript.runtime/core-sha ${ednString(prepared.lock.sha)}}}`;
const snapshotProgram = `
(require '[clojure.data.json :as json]
         '[datascript.core :as ds]
         '[eacl-demo.fixture :as fixture]
         '[eacl.core :as eacl]
         '[eacl.datascript.core :as eacl-datascript]
         '[eacl.datascript.schema :as eacl-datascript-schema])
(let [source-id "eacl-demo-fixture-v1"
      connection (ds/create-conn (eacl-datascript-schema/merge-schema))
      _ (alter-meta! connection assoc :eacl.datascript/source-id source-id)
      _ (ds/transact! connection
                      [{:eacl/id "datascript-metadata"
                        :eacl.datascript/source-id source-id}])
      client (eacl-datascript/make-client connection {})
      records (mapcat :records (fixture/small-fixture-bundles))
      objects (into [] (comp (filter #(= :object (:kind %)))
                             (map (fn [record]
                                    {:eacl/id (get-in record [:object :id])})))
                    records)
      relationships (into []
                          (comp
                           (filter #(= :relationship (:kind %)))
                           (map (fn [record]
                                  (eacl/->Relationship
                                   (eacl/spice-object
                                    (keyword (get-in record [:subject :type]))
                                    (get-in record [:subject :id]))
                                   (keyword (:relation record))
                                   (eacl/spice-object
                                    (keyword (get-in record [:resource :type]))
                                    (get-in record [:resource :id]))))))
                          records)]
  (eacl/write-schema! client fixture/schema)
  (ds/transact! connection objects)
  (eacl/create-relationships! client relationships)
  (spit ${ednString(snapshotOutput)}
        (json/write-str (ds/serializable (ds/db connection)))))`;
execFileSync("clojure", ["-Sdeps", override, "-M:datascript-runtime", "-e", snapshotProgram], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("clojure", [
  "-Sdeps", override,
  "-M:datascript-runtime",
  "-m", "cljs.main",
  "-t", "browser",
  "-O", "advanced",
  "-co", compilerOptions,
  "--output-dir", compilerOutput,
  "-o", output,
  "-c", "eacl-demo.datascript.runtime"
], { cwd: root, stdio: "inherit" });

const snapshot = await readFile(snapshotOutput);
const parsedSnapshot = JSON.parse(snapshot.toString("utf8"));
if (!parsedSnapshot || parsedSnapshot.count !== 87_435 ||
    parsedSnapshot.eavt?.length !== 87_435 || parsedSnapshot["max-eid"] !== 10_104) {
  throw new Error("generated DataScript snapshot does not contain the exact fixture database");
}
const compiled = await readFile(output);
const bytes = Buffer.concat([
  Buffer.from(`window["__EACL_DATASCRIPT_SNAPSHOT__"]=${snapshot.toString("utf8")};\n`, "utf8"),
  compiled,
]);
await writeFile(output, bytes);
if (!bytes.includes(Buffer.from(prepared.lock.sha, "utf8"))) throw new Error("compiled DataScript runtime does not contain the locked EACL Core SHA");
if (bytes.includes(Buffer.from("0000000000000000000000000000000000000000", "utf8"))) throw new Error("compiled DataScript runtime retained the unconfigured EACL Core identity");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schemaVersion: 1,
  unit: "datascript-runtime",
  kind: "static-entry",
  runtime: "clojurescript-browser",
  entryNamespace: "eacl-demo.datascript.runtime",
  adapter: "dev.eacl/eacl-datascript",
  eaclCoreSha: prepared.lock.sha,
  artifact: { path: "datascript-runtime.js", sha256, bytes: bytes.length },
  deploymentEligible: unit.deploymentEligible,
  qualificationState: unit.deploymentTrack === "parked" ? "parked" : unit.deploymentEligible ? "eligible" : "foundation-only"
};
await writeFile(path.join(target, "artifact.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`datascript-runtime\tsha256:${sha256}\t${bytes.length} bytes\tEACL ${prepared.lock.sha}`);

function ednString(value) {
  return JSON.stringify(value);
}
