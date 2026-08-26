import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { expectedJankBuilderConfirmation, verifyJankBuilderWorkload } from "./verify-jank-builder-workload.mjs";

const lock = JSON.parse(await readFile(new URL("../dependencies/jank-linux-x86_64-builder.v1.json", import.meta.url), "utf8"));
const demoSha = "1".repeat(40);

test("Jank builder execution is bound to one exact content-addressed workload", async () => {
  const verified = await verifyJankBuilderWorkload();
  assert.equal(verified.workloadDigest, lock.buildWorkload.workloadDigest);
  assert.equal(verified.dockerfileDigest, lock.buildWorkload.dockerfileSha256);
  assert.equal(expectedJankBuilderConfirmation(lock.buildWorkload, demoSha), `BUILD:${lock.buildWorkload.workloadDigest.slice(7)}:${demoSha}`);
});

test("Jank builder confirmation cannot cross workload or demo revisions", async () => {
  const confirmation = expectedJankBuilderConfirmation(lock.buildWorkload, demoSha);
  await assert.rejects(
    verifyJankBuilderWorkload({ confirmation: `${confirmation}0`, demoSha, requireConfirmation: true, requireCleanCheckout: false }),
    /confirmation/u
  );
  await assert.rejects(
    verifyJankBuilderWorkload({ confirmation, demoSha: "2".repeat(40), requireConfirmation: true, requireCleanCheckout: false }),
    /confirmation/u
  );
});
