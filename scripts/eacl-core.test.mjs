import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import path from "node:path";
import {
  EACL_REPOSITORY,
  committedEaclCore,
  parseEaclCore,
  parseEaclRelease,
  pomScmTag,
  readEaclCore,
  readEaclRelease,
} from "./lib/eacl-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const SHA = "a".repeat(40);
const VERSION = "8.0.0-RC-2026-10-02";

const UNIFORM = `
{:aliases
 {:datahike-s3
  {:extra-deps
   {dev.eacl/eacl-datahike {:mvn/version "${VERSION}"}}}
  :datascript-runtime
  {:extra-deps
   {dev.eacl/eacl-datascript {:mvn/version "${VERSION}"}
    com.github.theronic/cljs-cache
    {:git/url "https://github.com/theronic/cljs-cache.git"
     :git/sha "4143cc036446a47f0c6dfd9f8dde90363835051c"}}}
  :datalevin-memory
  {:extra-deps
   {dev.eacl/eacl {:mvn/version "${VERSION}"}
    dev.eacl/eacl-datalevin
    {:local/root "target/eacl-core-source/${SHA}/modules/eacl-datalevin"}}}}}
`;

test("uniform pins parse to one published release and its source commit", () => {
  const release = parseEaclRelease(UNIFORM);
  assert.equal(release.repository, EACL_REPOSITORY);
  assert.equal(release.version, VERSION);
  assert.equal(release.sha, SHA);
  assert.deepEqual(release.modules,
    ["modules/eacl", "modules/eacl-datahike", "modules/eacl-datalevin", "modules/eacl-datascript"]);
});

test("the Core identity is the release's source commit", () => {
  const identity = parseEaclCore(UNIFORM);
  assert.deepEqual(Object.keys(identity).sort(), ["modules", "repository", "sha"]);
  assert.equal(identity.repository, EACL_REPOSITORY);
  assert.equal(identity.sha, SHA);
});

test("divergent release versions fail, naming the offending alias", () => {
  const divergent = UNIFORM.replace(`dev.eacl/eacl-datahike {:mvn/version "${VERSION}"}`,
    'dev.eacl/eacl-datahike {:mvn/version "8.0.0-RC-2026-09-12"}');
  assert.throws(() => parseEaclRelease(divergent), (error) => {
    assert.match(error.message, /versions disagree/u);
    assert.match(error.message, /alias :datahike-s3/u);
    return true;
  });
});

test("divergent source commits fail", () => {
  const divergent = UNIFORM.replace(`dev.eacl/eacl-datahike {:mvn/version "${VERSION}"}`,
    `dev.eacl/eacl-datahike {:mvn/version "${VERSION}"}
    dev.eacl/eacl-datalevin {:local/root "target/eacl-core-source/${"b".repeat(40)}/modules/eacl-datalevin"}`);
  assert.throws(() => parseEaclRelease(divergent), /source commits disagree/u);
});

test("an EACL Git dependency fails; other Git dependencies are allowed", () => {
  const git = UNIFORM.replace(`dev.eacl/eacl-datahike {:mvn/version "${VERSION}"}`,
    `dev.eacl/eacl-datahike {:git/url "${EACL_REPOSITORY}" :git/sha "${SHA}" :deps/root "modules/eacl-datahike"}`);
  assert.throws(() => parseEaclRelease(git), /dev\.eacl\/eacl-datahike as a Git dependency/u);
});

test("malformed versions and source commits fail", () => {
  assert.throws(() => parseEaclRelease(UNIFORM.replaceAll(`"${VERSION}"`, '"RELEASE"')),
    /malformed dev\.eacl\/eacl-datahike :mvn\/version/u);
  assert.throws(() => parseEaclRelease(UNIFORM.replace(SHA, "main")),
    /malformed EACL source commit/u);
});

test("a deps.edn without a release or a source commit fails", () => {
  assert.throws(() => parseEaclRelease("{:deps {org.clojure/clojure {:mvn/version \"1.12.5\"}}}"),
    /no published EACL release/u);
  assert.throws(() => parseEaclRelease(`{:deps {dev.eacl/eacl-datomic {:mvn/version "${VERSION}"}}}`),
    /no EACL release source commit/u);
});

test("the published POM's SCM tag is read exactly", () => {
  const pom = `<project><version>${VERSION}</version><scm>
    <connection>scm:git:${EACL_REPOSITORY}</connection>
    <tag>${SHA}</tag>
  </scm></project>`;
  assert.equal(pomScmTag(pom), SHA);
  assert.equal(pomScmTag(pom.replace(SHA, "HEAD")), null);
  assert.equal(pomScmTag(`<project><tag>${SHA}</tag></project>`), null);
});

test("the repository deps.edn derives one release and one 40-hex identity", () => {
  const release = readEaclRelease(root);
  assert.match(release.version, /^[0-9]/u);
  const identity = readEaclCore(root);
  assert.match(identity.sha, /^[0-9a-f]{40}$/u);
  assert.equal(identity.sha, release.sha);
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
