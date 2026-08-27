import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { assertEaclFormalIsIndependent, assertManualAssuranceWorkflows, assertOrdinaryDemoWorkflowPolicy } from "./src/workflow-policy.mjs";

const root = path.resolve(import.meta.dirname, "../..");

const ordinary = `name: Deploy EACL demos
on:
  push:
    branches:
      - demos
permissions:
  contents: read
jobs:
  build-static:
    runs-on: ubuntu-24.04
    steps:
      - run: npm run build:static-site
      - uses: actions/upload-artifact@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  deploy-static:
    needs: build-static
    runs-on: ubuntu-24.04
    environment: demo-production-static
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/download-artifact@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
      - run: sha256sum --check artifact.sha256
      - run: node scripts/run-merge-smoke.mjs
`;

test("ordinary demos deployment permits parallel build/deploy/smoke only", () => {
  assert.equal(assertOrdinaryDemoWorkflowPolicy(ordinary), true);
  const forbidden = [
    `${ordinary}\nconcurrency:\n  cancel-in-progress: true\n`,
    ordinary.replace("needs: build-static", "needs: verify"),
    ordinary.replace("id-token: write", "id-token: write\n      # npm install must never run with OIDC\n      # npm install"),
    ordinary.replace("sha256sum --check artifact.sha256", "echo unchecked"),
    ordinary.replace("actions/upload-artifact@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "actions/cache@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ordinary.replace("actions/download-artifact@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "actions/download-artifact@v4"),
    ordinary.replace("npm run build", "npm run formal-verification"),
    ordinary.replace("npm run build", "npm run load-test"),
    ordinary.replace("npm run build", "npm run seed"),
    ordinary.replace("  push:", "  workflow_run:"),
    ordinary.replace("npm run build", "gh workflow run stateful-data.yml"),
    ordinary.replace("npm run build", "aws dynamodb update-table --table-name demo"),
    ordinary.replace("npm run build", "aws ec2 run-instances --image-id ami-123"),
    ordinary.replace("npm run build", "aws cloudformation deploy --template-file infra/data/table.yaml"),
    ordinary.replace("npm run build", "echo $AWS_STATEFUL_ROLE_ARN"),
    `${ordinary}\n  reusable:\n    uses: ./.github/workflows/stateful-data.yml\n`
  ];
  for (const source of forbidden) assert.throws(() => assertOrdinaryDemoWorkflowPolicy(source));
});

test("committed demos deployment satisfies the ordinary isolation policy", () => {
  const committed = readFileSync(path.join(root, ".github/workflows/deploy-demos.yml"), "utf8");
  assert.equal(assertOrdinaryDemoWorkflowPolicy(committed), true);
});

test("ordinary deployment cannot use a broad deleting static sync", () => {
  for (const command of ["aws s3 sync dist/static-site s3://bucket --delete", "aws s3 sync dist/static-site s3://bucket"]) {
    assert.throws(() => assertOrdinaryDemoWorkflowPolicy(ordinary.replace("npm run build:static-site", command)), /static synchronization|deletion/u);
  }
});

test("EACL formal workflow remains independent and cannot cross-dispatch", () => {
  const formal = "name: Formal verification\non:\n  push:\n    branches: ['**']\n  workflow_dispatch:\njobs: {}\n";
  assert.equal(assertEaclFormalIsIndependent(ordinary, formal), true);
  assert.throws(() => assertEaclFormalIsIndependent(ordinary, `${formal}\n# dispatch theronic/eacl-demo workflow\n`), /triggers the demo/u);
  assert.throws(() => assertEaclFormalIsIndependent(ordinary.replace("npm run build", "theronic/eacl/.github/workflows/formal.yml"), formal));
});

test("manual assurance retains real full, browser, accessibility, runtime, seed, migration, and rollback workflows", () => {
  const source = (relative) => readFileSync(path.join(root, relative), "utf8");
  assert.equal(assertManualAssuranceWorkflows({
    fullQualification: source(".github/workflows/qualify-profile.yml"),
    explorerQualification: source(".github/workflows/qualify-explorer.yml"),
    explorerSpec: source("verification/explorer/explorer.spec.ts"),
    runtimeExercise: source(".github/workflows/exercise-profile-runtime.yml"),
    transitionExercise: source(".github/workflows/exercise-profile-transition.yml"),
    datomicSeed: source(".github/workflows/stateful-datomic-seed.yml"),
    datahikeGeneration: source(".github/workflows/stateful-datahike-dynamodb.yml"),
    datomicGeneration: source(".github/workflows/stateful-datomic-dynamodb.yml")
  }), true);
});
