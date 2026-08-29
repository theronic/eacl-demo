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
  ["components/Common.tsx", "d80701afde3816fd76eee67400b6e83c909ff959aa07633aa2ba142dea6306d1"],
  ["components/SchemaGraph.tsx", "98709de62da77c47dbf35999b9bd69c5ba6f716ec178690f54a0ecbb64aa0c00"],
  ["format.ts", "f0bfe6aa90b3708ecb82647f3977481bc6db23844f21a0f292b6ef10359445d0"],
  ["preferences.ts", "edb035663ef3cbd0c8e3f7a13d72b6af3aa03e721f8bef48f7b860930cd98632"],
]);

test("unchanged Explorer components remain byte-identical to the current Datahike Explorer", () => {
  for (const [relative, canonicalHash] of exactDatahikeFiles) {
    assert.equal(sha(file(resolve(demoSource, relative))), canonicalHash, relative);
    const sibling = resolve(datahikeSource, relative);
    if (existsSync(sibling)) assert.equal(sha(file(sibling)), canonicalHash, `source ${relative}`);
  }
});

test("the stylesheet keeps approved UI deltas and avoids costly scrolling effects", () => {
  const demo = file(resolve(demoSource, "styles.css"));
  const withoutDeploymentWarning = demo.replace(
    /\n\n\/\* DEPLOYMENT_WARNING_START \*\/[\s\S]*?\/\* DEPLOYMENT_WARNING_END \*\/\n/u,
    "\n",
  );
  const withoutCanFooter = withoutDeploymentWarning.replace(
    /\n\n\/\* CAN_PERMISSION_FOOTER_START \*\/[\s\S]*?\/\* CAN_PERMISSION_FOOTER_END \*\/\n/u,
    "\n",
  );
  const withoutDecisionRules = withoutCanFooter.replace(
    /\n\n\/\* DATOMIC_PERMISSION_DECISIONS_START \*\/[\s\S]*?\/\* DATOMIC_PERMISSION_DECISIONS_END \*\/\n\n/u,
    "\n\n",
  );
  const approvedPrimaryControlRules = `.profile-selector__option {
  padding: 7px 12px;
  font-size: 1rem;
}
`;
  const approvedConsistencyNoteRules = `.basis-info__note--consistency {
  max-width: none;
  font-size: 0.84rem;
  text-align: left;
}
`;
  const approvedFreshnessFloorRules = `.freshness-floor-control {
  display: grid;
  gap: 0.65rem;
  min-width: min(100%, 31rem);
}

.freshness-floor-control__modes {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.freshness-floor-control__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.freshness-floor-control .basis-info__note {
  max-width: 48rem;
  margin: -0.2rem 0 0;
}
`;
  const approvedFreshnessSecondsRules = `.freshness-control__input--seconds {
  width: 7rem;
}
`;
  assert.equal(withoutDecisionRules.includes(approvedPrimaryControlRules), true);
  assert.equal(withoutDecisionRules.includes(approvedConsistencyNoteRules), true);
  assert.equal(withoutDecisionRules.includes(approvedFreshnessFloorRules), true);
  assert.equal(withoutDecisionRules.includes(approvedFreshnessSecondsRules), true);
  const withoutApprovedRules = withoutDecisionRules
    .replace(`${approvedPrimaryControlRules}\n`, "")
    .replace(`${approvedConsistencyNoteRules}\n`, "")
    .replace(`${approvedFreshnessFloorRules}\n`, "")
    .replace(`${approvedFreshnessSecondsRules}\n`, "");
  assert.doesNotMatch(demo, /backdrop-filter|radial-gradient|--body-(?:glow|start|end)|--header-(?:start|end)/u);
  assert.match(demo, /body \{[\s\S]*?background: var\(--bg\);/u);
  assert.match(demo, /\.panel-card \{[\s\S]*?background: var\(--panel\);/u);
  assert.match(demo, /\.graph-canvas \{[\s\S]*?background: var\(--graph-start\);/u);
  assert.equal(
    sha(withoutApprovedRules),
    "fb46720950283a3e7508b85a27e00920de579bd4fe529c3504b27f419eb5d3ed",
  );
  const decisionRules = between(
    demo,
    ".permission-decisions {",
    "/* DATOMIC_PERMISSION_DECISIONS_END */",
  ).trimEnd();
  assert.equal(
    sha(decisionRules),
    "2558a71d874afeffba820e267829eb70a62776648d78f73135dd258d19c4e4b8",
  );
  if (existsSync(resolve(datomicSource, "styles.css"))) {
    const datomic = file(resolve(datomicSource, "styles.css"));
    assert.equal(
      decisionRules,
      between(datomic, ".permission-decisions {", ".active-summary {").trimEnd(),
    );
  }
});

test("canonical layout order is unchanged except for the profile selector", () => {
  const explorer = file(resolve(demoSource, "Explorer.tsx"));
  assertOrdered(explorer, [
    "<Header />",
    "{props.profileSelector}",
    "<SchemaPanel />",
    "<CachePanel />",
    "<ConsistencyPanel />",
    '<main class="panel-grid">',
    "<SubjectsPanel />",
    "<ResourceTreePanel />",
    "<DetailPanel />",
    "<CanPermissionFooter",
    '<footer class="app-footer">',
  ]);
  assert.doesNotMatch(explorer, /dashboard|report|verified profile facts|storage stats/iu);

  const selector = file(resolve(demoSource, "components/ProfileSelector.tsx"));
  assert.equal((selector.match(/type="radio"/gu) ?? []).length, 3);
  assert.doesNotMatch(selector, /<select|<option/iu);
  assert.match(selector, /Backend &amp; Storage/u);
  assert.match(selector, /Platform:/u);
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
  ]) assert.match(component, new RegExp(escapeRegExp(feature), "u"), feature);
  assert.match(explorer, /app\.runQuery<PermissionDecision>\(canRequest, "\/check-permission"/u);
});

test("requested copy and control moves are the only component deltas", () => {
  const description = /🦅 EACL: Enterprise Access ControL is a ReBAC Authorization library\s+inspired by SpiceDB, built in Clojure and backed by Datomic Pro,\s+Datahike or DataScript\./u;
  const header = file(resolve(demoSource, "components/Header.tsx"));
  const app = file(resolve(demoSource, "App.tsx"));
  assert.match(header, description);
  assert.match(app, description);
  assert.doesNotMatch(`${header}\n${app}`, /Reactive authorization over explicit, inspectable HTTP queries/u);
  const cache = file(resolve(demoSource, "components/CachePanel.tsx"));
  assert.match(cache, /capturedOnFirstOpen/u);
  const schema = file(resolve(demoSource, "components/SchemaPanel.tsx"));
  assert.doesNotMatch(schema, /SPICE SCHEMA/u);
  const subjects = file(resolve(demoSource, "components/SubjectsPanel.tsx"));
  assert.match(subjects, />Subjects</u);
  assert.doesNotMatch(subjects, /Active subject|Subjects &amp; Permissions/u);
  const resources = file(resolve(demoSource, "components/ResourceTree.tsx"));
  assert.match(resources, />Permission</u);
});

test("consistency controls retain the original Explorer vocabulary", () => {
  const panel = file(resolve(demoSource, "components/ConsistencyPanel.tsx"));
  const state = file(resolve(demoSource, "state.tsx"));
  assert.doesNotMatch(panel, /["']current["']/u);
  assert.match(panel, /"minimize-latency"/u);
  assert.match(state, /createSignal<ConsistencyMode>\("minimize-latency"\)/u);
});

test("DataScript has no independent presentation component or stylesheet", () => {
  assert.equal(
    file(resolve(repository, "apps/explorer-datascript/index.html")),
    file(resolve(repository, "apps/explorer-main/index.html")),
  );
  const app = file(resolve(datascriptSource, "App.tsx"));
  assert.match(app, /import ExplorerApp from "\.\.\/\.\.\/explorer-main\/src\/App";/u);
  assert.match(app, /<ExplorerApp\s/u);
  for (const forbidden of [
    "packages/ui",
    "ServerExplorer",
    "ExplorerHeader",
    "PanelBoundary",
    "ThemeControl",
    "class=",
  ]) assert.doesNotMatch(app, new RegExp(escapeRegExp(forbidden), "u"), forbidden);

  const entry = file(resolve(datascriptSource, "main.tsx"));
  assert.match(entry, /import "\.\.\/\.\.\/explorer-main\/src\/styles\.css";/u);
  assert.equal((entry.match(/\.css";/gu) ?? []).length, 1);
  assert.equal(existsSync(resolve(datascriptSource, "styles.css")), false);
  assert.equal(existsSync(resolve(demoSource, "ServerExplorer.tsx")), false);
});

test("both deployments instantiate the canonical Explorer through one App", () => {
  const app = file(resolve(demoSource, "App.tsx"));
  assert.match(app, /entry\?: "server" \| "datascript"/u);
  assert.match(app, /createDataScriptTransport\?:/u);
  assert.match(app, /const api = createProfileApi\(props\.profile, \{ transport: props\.transport \}\)/u);
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
    "Can active subject?",
    "PermissionDecisionRow",
    "app.populateCache()",
    "app.activeQueryBasis()",
    "app.basisGeneration()",
    "app.queryGeneration()",
    "JSON.stringify(app.consistency())",
    "app.runQuery<PermissionDecision>",
    "app.runQuery<ObjectPage>",
    "<MetaTiming",
  ]) assert.match(detail, new RegExp(escapeRegExp(feature), "u"), feature);
  assert.ok(detail.indexOf("<PermissionDecisions") < detail.indexOf("<For\n              each={permissions()}"));
});

test("original paging and timing metadata are present end to end", () => {
  const types = file(resolve(demoSource, "types.ts"));
  assert.match(types, /PAGE_SIZE_OPTIONS = \[10, 20, 50, 100, 250, 500, 1000\] as const/u);
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
