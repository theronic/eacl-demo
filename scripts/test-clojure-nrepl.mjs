import { execFileSync } from "node:child_process";
import process from "node:process";

const port = process.env.EACL_NREPL_PORT ?? process.argv[2];
if (!port || !/^[1-9][0-9]{0,4}$/u.test(port) || Number(port) > 65535) {
  throw new Error("Set EACL_NREPL_PORT or pass one explicit nREPL port; implicit selection could target another checkout.");
}

const namespaceText = process.env.EACL_TEST_NAMESPACES ?? "eacl-demo.foundation-test";
const namespaces = namespaceText.split(",").map((value) => value.trim()).filter(Boolean);
if (namespaces.length === 0 || namespaces.some((value) => !/^[a-z][a-z0-9.-]*$/u.test(value))) {
  throw new Error("EACL_TEST_NAMESPACES must be a comma-separated list of Clojure namespace symbols.");
}

const quotedNamespaces = namespaces.map((value) => `'${value}`).join(" ");
const requireForms = namespaces.map((value) => `(require '[${value}] :reload)`).join(" ");
const form = `(do (require '[clojure.test :as test]) ${requireForms} (let [result (test/run-tests ${quotedNamespaces}) failures (+ (:fail result) (:error result))] {:eacl-test-status (if (and (pos? (:test result)) (zero? failures)) :passed :failed) :result result}))`;

const output = execFileSync("clj-nrepl-eval", ["-p", port, form], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
});
process.stdout.write(output);
const evaluationLines = [...output.matchAll(/^=> (.+)$/gmu)];
const finalEvaluation = evaluationLines.at(-1)?.[1] ?? "";
if (!/^\{:eacl-test-status :passed, :result \{.*:test [1-9][0-9]*,.*:fail 0,.*:error 0,.*\}\}$/u.test(finalEvaluation)) {
  throw new Error("The nREPL test evaluation did not return an explicit passing sentinel.");
}
