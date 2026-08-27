import { sealFastestEvidence } from "../src/fastest-evidence.mjs";

export function fastestEvidence(overrides = {}) {
  const base = {
    schema: "eacl-demo.fastest-storage-evidence.v1",
    methodVersion: "datahike-storage-million.v1",
    backend: "datahike",
    profiles: ["datahike-s3", "datahike-dynamodb"],
    fixture: {
      id: "eacl-demo-fixture-v1",
      manifestDigest: "sha256:718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0",
      fixtureDigest: "sha256:102bb7c51779bb66ab343dabff42019af95f99bded708e214b13fd56ab3bf33c",
      schemaDigest: "sha256:7fa7ae57dec4e442c66815ea74a63b08f12a79d7e9a716ebc8f1d6b03ee2262c",
      logicalResourceCount: 1_000_000
    },
    workload: {
      id: "datahike-storage-million-v1",
      digest: "sha256:dc620652915a005b59af3a92151a4b4813696ee0d41cf9f1b0eec992bfa096fc",
      requestsPerWave: 100,
      operationWeights: { checkPermission: 40, bootstrap: 5, countObjects: 10, getObject: 10, getSchema: 5, listRelationships: 15, listSubjects: 5, reverseRelationships: 10 },
      cacheLanesDigest: `sha256:${"c".repeat(64)}`
    },
    environment: { region: "us-east-1", runtime: "java25", architecture: "arm64", memoryMb: 1024, snapStart: "PublishedVersions", timeoutSeconds: 30, ephemeralStorageMiB: 512, productionPath: "function-url-v2" },
    repetitions: { coldOrRestore: 30, warmWavesPerLane: 30, concurrency: [1, 8], bootstrapResamples: 10_000 },
    measuredAt: "2026-08-25T12:00:00Z",
    expiresAt: "2026-09-24T12:00:00Z",
    candidates: [candidate("datahike-s3", "s3", "d"), candidate("datahike-dynamodb", "dynamodb", "e")],
    results: [
      { profileId: "datahike-s3", warmWeightedP95Ms: 30, coldOrRestoreP95Ms: 800, warmP95Ci95Ms: [29, 31], coldP95Ci95Ms: [780, 820], errorRate: 0, projectedMonthlyUsd: 4, warmSamples: 6_000, coldSamples: 30 },
      { profileId: "datahike-dynamodb", warmWeightedP95Ms: 20, coldOrRestoreP95Ms: 900, warmP95Ci95Ms: [19, 21], coldP95Ci95Ms: [880, 920], errorRate: 0, projectedMonthlyUsd: 5, warmSamples: 6_000, coldSamples: 30 }
    ],
    decision: { outcome: "winner", defaultProfileId: "datahike-dynamodb", selectionBasis: "warm-cache-disabled-p95", primaryMetric: "operation-weighted-warm-cache-disabled-service-p95-ms", minimumEffectFraction: 0.05, tieBreakOrder: ["cold-or-restore-p95-ms", "projected-monthly-usd"] }
  };
  return sealFastestEvidence(deepMerge(base, overrides));
}

function candidate(profileId, storage, artifactPrefix) {
  return {
    profileId, storage,
    demoSha: "a".repeat(40), eaclSha: "e06e429d1cf6ed686fc294924241312379b3bb3e",
    artifactDigest: `sha256:${artifactPrefix.repeat(64)}`, deploymentId: `${profileId}-deployment`, serviceCodeDigest: `sha256:${"f".repeat(64)}`,
    dataLifecycleId: `${profileId}-fixture-v1`, dataManifestDigest: "sha256:718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0",
    qualificationEvidenceId: `sha256:${"9".repeat(64)}`, qualificationExpiresAt: "2026-10-24T12:00:00Z", qualificationPassing: true,
    contractVersion: "explorer.v1", region: "us-east-1", runtime: "java25", architecture: "arm64", memoryMb: 1024,
    snapStart: "PublishedVersions", timeoutSeconds: 30, ephemeralStorageMiB: 512,
    workloadDigest: "sha256:dc620652915a005b59af3a92151a4b4813696ee0d41cf9f1b0eec992bfa096fc",
    cacheLanesDigest: `sha256:${"c".repeat(64)}`
  };
}

function deepMerge(left, right) {
  if (!right || typeof right !== "object" || Array.isArray(right)) return right === undefined ? left : right;
  const result = structuredClone(left);
  for (const [key, value] of Object.entries(right)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object"
      ? deepMerge(result[key], value)
      : structuredClone(value);
  }
  return result;
}
