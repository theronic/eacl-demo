import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(await readFile(
  path.join(root, "build-units.json"), "utf8",
));

test("the active rollout excludes only the explicitly parked Jank unit", () => {
  const tracks = Object.fromEntries(
    Object.entries(registry.units).map(([name, unit]) => {
      assert.deepEqual(
        Object.keys(unit).sort(),
        ["deploymentEligible", "deploymentTrack", "kind", "ordinaryDeploymentTarget", "source", "target"],
        `${name} has an open or incomplete release-scope record`,
      );
      if (unit.deploymentTrack === "parked") {
        assert.equal(unit.deploymentEligible, false, `${name} is both parked and eligible`);
      }
      return [name, unit.deploymentTrack];
    }),
  );
  assert.deepEqual(
    Object.entries(tracks).filter(([, track]) => track === "parked").map(([name]) => name),
    ["jank-memory"],
  );
  assert.equal(
    Object.values(tracks).every((track) => ["active", "parked"].includes(track)),
    true,
  );
  assert.equal(registry.units["jank-memory"].deploymentEligible, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(registry.units).map(([name, unit]) => [name, unit.ordinaryDeploymentTarget])),
    {
      "explorer-main": "static",
      "datascript-entry": "static",
      "datascript-worker": "static",
      "datahike-s3": "datahike-s3",
      "datahike-dynamodb": "datahike-dynamodb",
      "datomic-dynamodb": "datomic-dynamodb",
      "datalevin-memory": "datalevin-memory",
      "jank-memory": "jank-memory",
      fixtures: "static",
      infrastructure: null,
    },
  );
});

test("foundation manifests cannot share concrete artifact roots", () => {
  const targets = Object.entries(registry.units).map(([name, unit]) => {
    assert.match(unit.target,
      /^dist\/foundation-[a-z0-9]+(?:-[a-z0-9]+)*$/u,
      `${name} lacks an isolated foundation target`);
    return unit.target;
  });
  assert.equal(new Set(targets).size, targets.length,
    "foundation targets must be unique");

  const concreteRoots = [
    "dist/explorer-main", "dist/datascript-entry", "dist/datascript-worker",
    "dist/static-site", "dist/datahike-s3", "dist/datahike-dynamodb",
    "dist/datomic-dynamodb", "dist/datomic-dynamodb-seed",
    "dist/datalevin-memory", "dist/jank-memory", "dist/fixtures",
    "dist/infrastructure",
  ];
  for (const target of targets) {
    for (const concrete of concreteRoots) {
      assert.equal(target === concrete || target.startsWith(`${concrete}/`) ||
        concrete.startsWith(`${target}/`), false,
      `foundation target ${target} overlaps concrete root ${concrete}`);
    }
  }
});
