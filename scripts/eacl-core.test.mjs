import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import path from "node:path";
import {
  EACL_REPOSITORY,
  committedEaclCore,
  parseEaclCore,
  readEaclCore,
} from "./lib/eacl-core.mjs";

const root = path.resolve(import.meta.dirname, "..");

const UNIFORM = `
{:aliases
 {:datahike-s3
  {:extra-paths ["target/eacl-core-source/${"a".repeat(40)}/target/formal/java/classes"]
   :extra-deps
   {dev.eacl/eacl-datahike
    {:git/url "https://github.com/theronic/eacl.git"
     :git/sha "${"a".repeat(40)}"
     :deps/root "modules/eacl-datahike"}}}
  :datalevin-memory
  {:extra-deps
   {dev.eacl/eacl-datalevin
    {:local/root "target/eacl-core-source/${"a".repeat(40)}/modules/eacl-datalevin"}}}}}
`;

test("uniform pins parse to a single canonical identity", () => {
  const identity = parseEaclCore(UNIFORM);
  assert.equal(identity.repository, EACL_REPOSITORY);
  assert.equal(identity.sha, "a".repeat(40));
  assert.deepEqual(identity.modules,
    ["modules/eacl", "modules/eacl-datahike", "modules/eacl-datalevin"]);
});

test("divergent pins fail, naming the offending alias", () => {
  const divergent = UNIFORM.replace(`:git/sha "${"a".repeat(40)}"`, `:git/sha "${"b".repeat(40)}"`);
  assert.throws(() => parseEaclCore(divergent), (error) => {
    assert.match(error.message, /pins disagree/u);
    assert.match(error.message, /alias :datahike-s3/u);
    return true;
  });
});

test("a non-canonical repository url fails", () => {
  const foreign = UNIFORM.replace(EACL_REPOSITORY, "https://github.com/example/eacl.git");
  assert.throws(() => parseEaclCore(foreign), /non-canonical :git\/url/u);
});

test("a malformed sha fails", () => {
  const malformed = UNIFORM.replace(`:git/sha "${"a".repeat(40)}"`, ':git/sha "main"');
  assert.throws(() => parseEaclCore(malformed), /malformed :git\/sha/u);
});

test("a deps.edn without any Core pin fails", () => {
  assert.throws(() => parseEaclCore("{:deps {org.clojure/clojure {:mvn/version \"1.12.5\"}}}"),
    /no EACL Core pin/u);
});

test("the repository deps.edn derives one 40-hex identity", () => {
  const identity = readEaclCore(root);
  assert.match(identity.sha, /^[0-9a-f]{40}$/u);
  assert.equal(identity.repository, EACL_REPOSITORY);
  assert.ok(identity.modules.includes("modules/eacl"));
  assert.ok(identity.modules.length >= 2);
});

test("the committed deps.edn at HEAD parses to the same repository", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const identity = committedEaclCore(root, head);
  assert.equal(identity.repository, EACL_REPOSITORY);
  assert.match(identity.sha, /^[0-9a-f]{40}$/u);
});

test("committed reads require an exact commit", () => {
  assert.throws(() => committedEaclCore(root, "HEAD"), /40-hex/u);
});
