import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repository = resolve(import.meta.dirname, "..");
const demoSource = resolve(repository, "apps/explorer-main/src");
const datascriptSource = resolve(repository, "apps/explorer-datascript/src");
const datahikeSource = resolve(repository, "../eacl-datahike-demo/client/src");
const datomicSource = resolve(repository, "../eacl-datomic-solidjs/client/src");

const exactDatahikeFiles = new Map([
  ["components/SchemaGraph.tsx", "26997e38de43190a4b30bc185a20ba7598198db2b4c245e6aaf42e6aa47ab6fd"],
  ["format.ts", "f0bfe6aa90b3708ecb82647f3977481bc6db23844f21a0f292b6ef10359445d0"],
]);

test("unchanged Explorer components remain byte-identical to the current Datahike Explorer", () => {
  for (const [relative, canonicalHash] of exactDatahikeFiles) {
    assert.equal(sha(file(resolve(demoSource, relative))), canonicalHash, relative);
    const sibling = resolve(datahikeSource, relative);
    if (existsSync(sibling)) assert.equal(sha(file(sibling)), canonicalHash, `source ${relative}`);
  }
});

test("resource-first shell retains one shared connected explorer and simple scrolling", () => {
  const explorer=file(resolve(demoSource,"Explorer.tsx"));
  assertOrdered(explorer,["<Header />","{props.profileSelector}","<ConsistencyPanel />","<ResourceTreePanel />","<DetailPanel />","<CanPermissionFooter"]);
  assert.doesNotMatch(explorer, /<SubjectsPanel/);
  const header=file(resolve(demoSource,"components/Header.tsx"));
  assert.match(header, /<SubjectsPanel/);
  const css=file(resolve(demoSource,"resource-first.css"));
  assert.doesNotMatch(css,/backdrop-filter|scroll-behavior:smooth/);
  const selector=file(resolve(demoSource,"components/ProfileSelector.tsx"));
  assert.equal((selector.match(/type="radio"/g)??[]).length,3);
  assert.doesNotMatch(selector,/<select|<option/);
  assert.match(selector,/aria-label="Execution"/);
});

test("the arbitrary permission console is one reusable schema-driven component", () => {
  const component = file(resolve(demoSource, "components/CanPermissionFooter.tsx"));
  const explorer = file(resolve(demoSource, "Explorer.tsx"));
  for (const feature of [
    "export function CanPermissionFooter",
    "props.permissionsByType",
    "props.subjects()",
    "props.resources()",
    "setTimeout(() => void execute(), 175)",
    "manualGeneration",
    "<MetaTiming",
  ]) assert.ok(component.replace(/\s+/g, "").includes(feature.replace(/\s+/g, "")), feature);
  assert.ok(explorer.replace(/\s+/g, "").includes('app.runQuery<PermissionDecision>(canRequest,"/check-permission"'));
});

test("approved controls retain factual copy and diagnostics",()=>{
 const header=file(resolve(demoSource,"components/Header.tsx"));
 for(const term of ["is a situated", "authorization library inspired by", "https://clojure.org/", "View As", "Seed Data"]) assert.ok(header.includes(term));
 assert.match(file(resolve(demoSource,"components/CachePanel.tsx")), /capturedOnFirstOpen/);
});

test("consistency controls retain the original Explorer vocabulary", () => {
  const panel = file(resolve(demoSource, "components/ConsistencyPanel.tsx"));
  const state = file(resolve(demoSource, "state.tsx"));
  assert.doesNotMatch(panel, /["']current["']/u);
  assert.match(panel, /"minimize-latency"/u);
  assert.match(state, /createSignal<ConsistencyMode>\("minimize-latency"\)/u);
});

test("DataScript has no independent presentation component or stylesheet", () => {
  for (const relative of ["index.html", "src/App.tsx", "src/main.tsx", "src/styles.css", "vite.config.ts"]) {
    assert.equal(existsSync(resolve(repository, "apps/explorer-datascript", relative)), false);
  }
  assert.equal(existsSync(resolve(demoSource, "ServerExplorer.tsx")), false);
});

test("both deployments instantiate the canonical Explorer through one App", () => {
  const app = file(resolve(demoSource, "App.tsx"));
  assert.match(app, /createDataScriptProfileTransport/u);
  assert.doesNotMatch(app, /window\.location\.(assign|replace)/u);
  assert.match(app, /const api = createProfileApi\(props\.profile, \{\n\s+transport: props\.transport,\n\s+sequential: props\.execution === "lambda",\n\s+\}\)/u);
  assert.equal((app.match(/<Explorer\s/gu) ?? []).length, 1);
  assert.doesNotMatch(app, /packages\/ui|ServerExplorer/u);
});

test("backend availability is not coupled to optional benchmark evidence", () => {
  const app = file(resolve(demoSource, "App.tsx"));
  assert.match(app, /loadProfilePublications/u);
  assert.doesNotMatch(app, /loadBenchmarkEvidence|benchmark-publication/u);
});

test("Detail is the union of Datomic decisions and Datahike query semantics", () => {
  const detail = file(resolve(demoSource, "components/DetailPanel.tsx"));
  for (const feature of [
    "PermissionDecisions",
    "Who Has Access?",
    "PermissionDecisionRow",
    "app.populateCache()",
    "app.activeQueryBasis()",
    "app.basisGeneration()",
    "app.queryGeneration()",
    "app.subjectType()",
    "app.runQuery<PermissionDecision>",
    "app.runQuery<ObjectPage>",
    "<MetaTiming",
  ]) assert.match(detail, new RegExp(escapeRegExp(feature), "u"), feature);
  assert.ok(detail.indexOf("<PermissionDecisions") < detail.indexOf("<PermissionSubjects"));
});

test("original paging and timing metadata are present end to end", () => {
  const types = file(resolve(demoSource, "types.ts"));
  assert.match(types, /PAGE_SIZE_OPTIONS = \[5, 10, 20, 25, 50, 100, 250, 500, 1000\] as const/u);
  const profileApi = file(resolve(demoSource, "profile-api.ts"));
  for (const feature of ["elapsedMs?: number", "cacheStatus?: ApiMeta", "result.meta.elapsedMs", "result.meta.cacheStatus", "populateCache: body.populateCache !== false"]) {
    assert.match(profileApi, new RegExp(escapeRegExp(feature), "u"), feature);
  }
  const schema = file(resolve(repository, "schemas/explorer.v1.schema.json"));
  assert.match(schema, /"elapsedMs": \{"type": "number", "minimum": 0\}/u);
  assert.match(schema, /"cacheStatus": \{"enum": \["hit", "miss", "disabled"\]\}/u);
});

function file(path) {
  return readFileSync(path, "utf8");
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function between(value, startText, endText) {
  const start = value.indexOf(startText);
  const end = value.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, startText);
  assert.notEqual(end, -1, endText);
  return value.slice(start, end);
}

function assertOrdered(value, fragments) {
  let position = -1;
  for (const fragment of fragments) {
    const next = value.indexOf(fragment, position + 1);
    assert.notEqual(next, -1, fragment);
    assert.ok(next > position, fragment);
    position = next;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
