import type { Page } from "@playwright/test";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createBenchmarkEvidenceIndex } from "../../packages/explorer-state/src/benchmark-publication.mjs";
import { createBaseRegistry, createProfilePublication } from "../../packages/explorer-state/src/profile-publication.mjs";

const readJson = (url: string) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [profileDefinitions, artifact] = await Promise.all([
  readJson("../../packages/contracts/profiles.v1.json"),
  readJson("../../dist/datascript-runtime/artifact.json")
]);
const baseRegistry = createBaseRegistry(profileDefinitions);
const demoSha = "a".repeat(40);
const dataManifestSha256 = "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a";

export { artifact };
export async function installPublications(page: Page) {
  const publishedAt = new Date();
  const deployedAt = new Date(publishedAt.getTime() - 1_000).toISOString();
  const baseline = baseRegistry.profiles.find(({ id }: { id: string }) => id === "datascript-browser-memory");
  const definition = profileDefinitions.profiles.find(({ id }: { id: string }) => id === "datascript-browser-memory");
  const deployment = {
    demoSha,
    eaclSha: artifact.eaclCoreSha,
    artifact: { kind: "static", sha256: artifact.artifact.sha256, version: "browser-qualification" },
    deploymentId: "datascript:browser-qualification",
    dataManifestSha256,
    deployedAt
  };
  const publication = await createProfilePublication({
    profile: {
      ...structuredClone(baseline), state: "enabled", reason: null, deployment,
      lastOutcome: { outcome: "succeeded", attemptedDemoSha: demoSha, attemptedEaclSha: artifact.eaclCoreSha, artifactSha256: artifact.artifact.sha256, at: deployedAt, message: "The direct browser runtime is enabled only inside this qualification fixture." }
    },
    definition,
    publishedAt: publishedAt.toISOString(),
    gate: { kind: "initial-qualification", evidenceId: `sha256:${"f".repeat(64)}` }
  }, { cryptoImpl: webcrypto, now: publishedAt });
  const profilePublications = new Map(await Promise.all(baseRegistry.profiles.map(async (profile: { id: string }) => {
    if (profile.id === "datascript-browser-memory") return [profile.id, publication] as const;
    const profileDefinition = profileDefinitions.profiles.find(({ id }: { id: string }) => id === profile.id);
    const record = await createProfilePublication({
      profile,
      definition: profileDefinition,
      publishedAt: publishedAt.toISOString(),
      gate: { kind: "merge-smoke", evidenceId: `sha256:${"e".repeat(64)}` },
    }, { cryptoImpl: webcrypto, now: publishedAt });
    return [profile.id, record] as const;
  })));
  const benchmarkIndex = await createBenchmarkEvidenceIndex({
    evidenceRecords: [],
    publishedAt: publishedAt.toISOString(),
  }, { cryptoImpl: webcrypto });
  await page.route("**/registry/profiles/*.json", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!.replace(/\.json$/u, "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profilePublications.get(id)) });
  });
  await page.route("**/registry/benchmark-evidence/index.v1.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(benchmarkIndex),
  }));

}
