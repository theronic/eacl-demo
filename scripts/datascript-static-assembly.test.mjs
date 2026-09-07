import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one production app supplies inert runtime metadata and legacy document aliases", async () => {
  const root = new URL("../dist/static-site/", import.meta.url);
  const [main, legacy, manifest] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("datascript/index.html", root), "utf8"),
    readFile(new URL("site-manifest.json", root), "utf8").then(JSON.parse),
  ]);
  assert.equal(main, legacy);
  assert.deepEqual(manifest.sourceBuilds, ["explorer-main", "datascript-runtime"]);
  assert.ok(main.includes(`<meta name="eacl-datascript-runtime" content="/${manifest.entries.datascriptRuntime}">`));
  assert.doesNotMatch(main, /<(?:script|link)[^>]*(?:src|href)=["'][^"']*datascript/u);
});
