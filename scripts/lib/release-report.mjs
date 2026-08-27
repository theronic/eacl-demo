import { createHash } from "node:crypto";

import { validateFastestEvidence } from "../../packages/explorer-state/src/fastest-evidence.mjs";
import { validateProfileEntry } from "../../packages/explorer-state/src/profile-entry.mjs";

const PROFILE_IDS = Object.freeze([
  "datahike-s3",
  "datahike-dynamodb",
  "datomic-dynamodb",
  "datalevin-memory",
  "jank-memory",
  "datascript-browser-memory"
]);
const SERVER_PROFILE_IDS = Object.freeze(PROFILE_IDS.filter((id) => id !== "datascript-browser-memory"));
const BACKENDS = Object.freeze(["datahike", "datomic", "datalevin", "jank", "datascript"]);
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEFINITION_PATH = /^(?:dependencies|fixtures|infra)\/[a-z0-9._/-]+$/u;

const PROFILE_INPUT = Object.freeze({
  "datahike-s3": {
    backend: "datahike",
    storage: "s3",
    route: "/api/v1/datahike-s3",
    buildUnits: ["datahike-s3"],
    fixtureResources: 1000000,
    runtimeDefinition: "infra/profiles/datahike-s3-runtime.yaml",
    runtime: "java25",
    architecture: "arm64",
    snapStart: "disabled"
  },
  "datahike-dynamodb": {
    backend: "datahike",
    storage: "dynamodb",
    route: "/api/v1/datahike-dynamodb",
    buildUnits: ["datahike-dynamodb"],
    fixtureResources: 1000000,
    runtimeDefinition: "infra/profiles/datahike-dynamodb-runtime.yaml",
    runtime: "java25",
    architecture: "arm64",
    snapStart: "disabled"
  },
  "datomic-dynamodb": {
    backend: "datomic",
    storage: "dynamodb",
    route: "/api/v1/datomic-dynamodb",
    buildUnits: ["datomic-dynamodb"],
    fixtureResources: 1000000,
    runtimeDefinition: "infra/profiles/datomic-dynamodb-runtime.yaml",
    runtime: "java25",
    architecture: "x86_64",
    snapStart: "disabled"
  },
  "datalevin-memory": {
    backend: "datalevin",
    storage: "memory",
    route: "/api/v1/datalevin-memory",
    buildUnits: ["datalevin-memory"],
    fixtureResources: 10000,
    runtimeDefinition: "infra/profiles/datalevin-memory-runtime.yaml",
    runtime: "java25",
    architecture: "arm64",
    snapStart: "enabled"
  },
  "jank-memory": {
    backend: "jank",
    storage: "memory",
    route: "/api/v1/jank-memory",
    buildUnits: ["jank-memory"],
    fixtureResources: 10000,
    runtimeDefinition: "infra/profiles/jank-memory-runtime.yaml",
    runtime: "provided.al2023",
    architecture: "x86_64",
    snapStart: "unsupported"
  },
  "datascript-browser-memory": {
    backend: "datascript",
    storage: "browser-memory",
    route: "/datascript/",
    buildUnits: ["explorer-main", "datascript-entry", "datascript-runtime"],
    fixtureResources: 10000,
    runtimeDefinition: null,
    runtime: "browser-javascript",
    architecture: "browser-managed",
    snapStart: "not-applicable"
  }
});

export function createPreReleaseReport({
  registry,
  profileDefinitions,
  buildUnits,
  eaclLock,
  fixtureManifests,
  benchmarkEvidenceRecords,
  sources
}) {
  validateInputs({ registry, profileDefinitions, buildUnits, eaclLock, fixtureManifests, benchmarkEvidenceRecords, sources });
  const fixtureByResources = new Map(fixtureManifests.map((fixture) => [fixture.cutPoint.logicalResources, fixture]));
  const alarmDefinition = definition("infra/observability/profile-runtime.yaml", sources);
  const centralDefinition = definition("infra/observability/template.yaml", sources);
  const dynamoDefinition = definition("infra/data/dynamodb-cost-controls.yaml", sources);
  const dynamoPolicyDefinition = definition("infra/data/dynamodb-cap-policy.v1.json", sources);
  const alarmCount = count(sources[alarmDefinition.path], /Type: AWS::CloudWatch::Alarm/gmu);
  invariant(alarmCount === 7, "profile alarm definition must contain exactly seven alarms");
  invariant(count(sources[dynamoDefinition.path], /Type: AWS::CloudWatch::Alarm/gmu) === 9,
    "DynamoDB cost-control definition must contain exactly nine alarms");
  const budgetThresholds = [...sources[centralDefinition.path].matchAll(/^\s+Threshold:\s+(50|80|100)$/gmu)]
    .map((match) => Number(match[1]));
  invariant(JSON.stringify(budgetThresholds) === JSON.stringify([50, 80, 100, 50, 80, 100]),
    "budget notification thresholds must be the exact two 50/80/100 sets");
  invariant(count(sources[centralDefinition.path], /Type: AWS::Budgets::Budget/gmu) === 2,
    "central definition must contain exactly two budgets");
  for (const name of ["MonthlyProjectBudget", "SeedBudget"]) {
    const block = yamlTopLevelBlock(sources[centralDefinition.path], name);
    invariant(/Type: AWS::Budgets::Budget/u.test(block), `${name} is not an AWS budget`);
    invariant(JSON.stringify([...block.matchAll(/^\s+Threshold:\s+(50|80|100)$/gmu)].map((match) => Number(match[1])))
      === JSON.stringify([50, 80, 100]), `${name} thresholds are invalid`);
  }
  for (const marker of ["TelegramNotifier:", "AlarmTopicSubscription:", "TELEGRAM_CHAT_ID: !Ref TelegramChatId", "TELEGRAM_SECRET_ARN: !Ref TelegramSecretArn"]) {
    invariant(sources[centralDefinition.path].includes(marker), `central notification definition lacks ${marker}`);
  }

  const profiles = registry.profiles.map((profile) => {
    const config = PROFILE_INPUT[profile.id];
    const fixture = fixtureByResources.get(config.fixtureResources);
    const runtimeDefinition = config.runtimeDefinition === null ? null : definition(config.runtimeDefinition, sources);
    if (runtimeDefinition !== null) validateRuntimeDefinition(sources[runtimeDefinition.path], config);
    const configuredMiB = runtimeDefinition === null ? null : memoryDefault(sources[runtimeDefinition.path]);
    return {
      id: profile.id,
      backend: profile.backend,
      storage: profile.storage,
      route: profile.route,
      availabilityState: profile.state,
      availabilityReason: profile.reason,
      buildUnits: [...config.buildUnits],
      deploymentEligible: config.buildUnits.every((unit) => buildUnits.units[unit].deploymentEligible === true),
      deployment: structuredClone(profile.deployment),
      lastOutcome: structuredClone(profile.lastOutcome),
      fixture: fixtureIdentity(fixture),
      runtime: {
        name: config.runtime,
        architecture: config.architecture,
        snapStart: config.snapStart
      },
      memory: runtimeDefinition === null
        ? { status: "browser-managed", configuredMiB: null, qualifiedMiB: null, evidenceId: null, definition: null }
        : { status: "candidate-unqualified", configuredMiB, qualifiedMiB: null, evidenceId: null, definition: runtimeDefinition },
      alarms: profile.id === "datascript-browser-memory"
        ? {
            status: "not-applicable",
            count: 0,
            definition: null,
            evidenceId: null,
            reason: "The DataScript profile runs in the browser and has no Lambda runtime alarms."
          }
        : {
            status: "defined-not-deployed",
            count: alarmCount,
            definition: alarmDefinition,
            evidenceId: null,
            reason: "The alarm template exists locally, but no profile-scoped live readiness evidence is published."
          },
      rollback: {
        status: "unavailable",
        kind: null,
        alias: null,
        statusObject: null,
        static: null,
        reason: "No successful consolidated publication has produced immutable rollback coordinates."
      }
    };
  });

  const capPolicy = JSON.parse(sources[dynamoPolicyDefinition.path]);
  const report = {
    "$schema": "../schemas/release-report.v1.schema.json",
    schema: "eacl-demo.release-report.v1",
    contractVersion: "explorer.v1",
    reportId: null,
    reportState: "pre-release",
    release: null,
    source: {
      demo: {
        repository: "https://github.com/theronic/eacl-demo.git",
        sha: null,
        status: "uncommitted",
        reason: "The report inputs are not bound to a clean immutable demo commit."
      },
      eacl: {
        repository: eaclLock.repository,
        sha: eaclLock.sha,
        status: "locked",
        reason: null,
        lock: definition("dependencies/eacl-core.lock.json", sources)
      }
    },
    benchmarkEvidence: structuredClone(registry.benchmarkEvidence),
    storageDefaults: structuredClone(registry.storageDefaults),
    fixtures: fixtureManifests.map((fixture) => ({
      ...fixtureIdentity(fixture),
      fixtureSha256: fixture.digests.fixture,
      semanticRecordsSha256: fixture.digests.semanticRecords,
      path: `fixtures/manifests/fixture-${fixture.cutPoint.logicalResources}.v1.json`
    })),
    profiles,
    costControls: {
      status: "defined-not-deployed",
      dynamodb: {
        status: "defined-not-deployed",
        alarmCountPerTable: 9,
        definition: dynamoDefinition,
        policy: dynamoPolicyDefinition,
        profiles: ["datahike-dynamodb", "datomic-dynamodb"].map((profileId) => ({
          profileId,
          seed: structuredClone(capPolicy.profiles[profileId].seed),
          serving: structuredClone(capPolicy.profiles[profileId].serving)
        })),
        evidenceId: null
      },
      budgets: [
        {
          id: "monthly-project",
          amountUsd: parameterDefault(sources[centralDefinition.path], "MonthlyBudgetUsd"),
          thresholdsPercent: [50, 80, 100],
          filter: "Project=eacl-demo",
          status: "defined-not-deployed",
          definition: centralDefinition,
          evidenceId: null
        },
        {
          id: "seed",
          amountUsd: parameterDefault(sources[centralDefinition.path], "SeedBudgetUsd"),
          thresholdsPercent: [50, 80, 100],
          filter: "Workload=eacl-demo-seed",
          status: "defined-not-deployed",
          definition: centralDefinition,
          evidenceId: null
        }
      ],
      anomalyDetection: {
        thresholdUsd: parameterDefault(sources[centralDefinition.path], "CostAnomalyThresholdUsd"),
        status: "defined-not-deployed",
        definition: centralDefinition,
        evidenceId: null
      },
      notifications: {
        channel: "telegram",
        status: "defined-not-verified",
        definition: centralDefinition,
        evidenceId: null,
        reason: "Routing is defined locally; no live delivery test is claimed by this report."
      }
    },
    blockers: [
      {
        code: "release-identity-unavailable",
        profiles: [],
        reason: "There is no deployed release manifest with an immutable demo source and artifact set.",
        requiredEvidence: "A successful demos-branch deployment release manifest and its content digest."
      },
      {
        code: "profiles-not-enabled",
        profiles: profiles.map(({ id }) => id),
        reason: "Every registered profile remains disabled, qualifying, or unavailable.",
        requiredEvidence: "Profile-specific qualification, deployment identity, and successful publication evidence."
      },
      {
        code: "live-cost-controls-unverified",
        profiles: ["datahike-dynamodb", "datomic-dynamodb"],
        reason: "Budget, alarm, anomaly, and Telegram definitions have no live readiness evidence in this report.",
        requiredEvidence: "Deployed resource identities, OK alarm state, enabled actions, and a successful Telegram delivery test."
      },
      {
        code: "rollback-coordinates-unavailable",
        profiles: profiles.map(({ id }) => id),
        reason: "No profile has exact prior and active publication coordinates.",
        requiredEvidence: "Immutable alias revisions or static prefixes plus versioned status-object rollback coordinates."
      }
    ]
  };
  return sealReleaseReport(report);
}

export function sealReleaseReport(report) {
  const value = structuredClone(report);
  value.reportId = contentId(value);
  return validateReleaseReport(value);
}

export function validateReleaseReport(report) {
  exactKeys(report, [
    "$schema", "schema", "contractVersion", "reportId", "reportState", "release",
    "source", "benchmarkEvidence", "storageDefaults", "fixtures", "profiles", "costControls", "blockers"
  ], "release report");
  invariant(report.$schema === "../schemas/release-report.v1.schema.json", "release report schema reference is invalid");
  invariant(report.schema === "eacl-demo.release-report.v1" && report.contractVersion === "explorer.v1",
    "release report version is invalid");
  invariant(DIGEST.test(report.reportId) && report.reportId === contentId(report), "release report content identity is invalid");
  invariant(new Set(["pre-release", "released"]).has(report.reportState), "release report state is invalid");
  validateSource(report.source, report.reportState);
  validateRelease(report.release, report.reportState, report.source);
  validateBenchmarkEvidence(report.benchmarkEvidence);
  validateStorageDefaults(report.storageDefaults, report.benchmarkEvidence);
  validateFixtures(report.fixtures);
  validateProfiles(report.profiles, report);
  validateCostControls(report.costControls);
  validateBlockers(report.blockers, report.reportState);
  const serialized = JSON.stringify(report);
  invariant(!/\b(?:latest|HEAD|dirty)\b/iu.test(serialized), "release report contains a mutable source claim");
  invariant(!/(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|bot[0-9]+:[A-Za-z0-9_-]{20,}/u.test(serialized),
    "release report contains credential-shaped material");
  return report;
}

export function renderReleaseReportMarkdown(report) {
  validateReleaseReport(report);
  const sourceRows = [report.source.demo, report.source.eacl]
    .map((source, index) => `| ${index === 0 ? "Demo" : "EACL Core"} | ${source.status} | ${source.sha ?? "—"} |`)
    .join("\n");
  const profileRows = report.profiles.map((profile) => {
    const memory = profile.memory.status === "browser-managed"
      ? "browser-managed"
      : `${profile.memory.configuredMiB} MiB candidate; unqualified`;
    const artifact = profile.deployment?.artifact?.sha256 ?? "—";
    return `| ${profile.id} | ${profile.availabilityState} | ${artifact} | ${profile.fixture.logicalResources.toLocaleString("en-US")} | ${memory} | ${profile.alarms.status} | ${profile.rollback.status} |`;
  }).join("\n");
  const defaultRows = report.storageDefaults.map((entry) =>
    `| ${entry.backend} | ${entry.outcome} | ${entry.profileId ?? "—"} | ${entry.evidenceId ?? "—"} | ${entry.reason ?? "—"} |`).join("\n");
  const fixtureRows = report.fixtures.map((fixture) =>
    `| ${fixture.logicalResources.toLocaleString("en-US")} | ${fixture.manifestSha256} | ${fixture.fixtureSha256} |`).join("\n");
  const budgetRows = report.costControls.budgets.map((budget) =>
    `| ${budget.id} | $${budget.amountUsd} | ${budget.thresholdsPercent.join(" / ")}% | ${budget.status} |`).join("\n");
  const blockerRows = report.blockers.map((blocker) =>
    `- \`${blocker.code}\`: ${blocker.reason} Required evidence: ${blocker.requiredEvidence}`).join("\n");
  return `# EACL demo release report\n\n` +
    `Report ID: \`${report.reportId}\`\n\n` +
    `Status: **${report.reportState}**. This is an honest readiness report, not evidence that a production release exists. ` +
    `Local infrastructure definitions are never described as deployed or verified without live evidence.\n\n` +
    `## Report-build source identity\n\n| Source | Status | Immutable SHA |\n| --- | --- | --- |\n${sourceRows}\n\n` +
    `This source pair identifies the report build, not a fleet generation. Every profile deployment below is independently authoritative and may come from a different demos-branch run.\n\n` +
    `## Profiles\n\n| Profile | Availability | Artifact SHA-256 | Fixture resources | Memory | Alarms | Rollback |\n| --- | --- | --- | ---: | --- | --- | --- |\n${profileRows}\n\n` +
    `Candidate memory values are template starting points only. No profile has a qualified memory setting or memory evidence ID.\n\n` +
    `## Storage defaults\n\n| Backend | Outcome | Default profile | Evidence | Reason |\n| --- | --- | --- | --- | --- |\n${defaultRows}\n\n` +
    `No performance superlative is claimed: the benchmark evidence set is empty.\n\n` +
    `## Fixtures\n\n| Logical resources | Manifest SHA-256 | Fixture SHA-256 |\n| ---: | --- | --- |\n${fixtureRows}\n\n` +
    `## Cost controls and notifications\n\n` +
    `DynamoDB controls: ${report.costControls.dynamodb.status}; ${report.costControls.dynamodb.alarmCountPerTable} alarm definitions per table. ` +
    `Telegram routing: ${report.costControls.notifications.status}. Cost anomaly threshold: $${report.costControls.anomalyDetection.thresholdUsd} (${report.costControls.anomalyDetection.status}).\n\n` +
    `| Budget | Default amount | Thresholds | Status |\n| --- | ---: | --- | --- |\n${budgetRows}\n\n` +
    `## Blocking evidence\n\n${blockerRows}\n`;
}

function validateInputs({ registry, profileDefinitions, buildUnits, eaclLock, fixtureManifests, benchmarkEvidenceRecords, sources }) {
  invariant(Array.isArray(registry?.profiles) && Array.isArray(registry?.storageDefaults), "profile registry input is invalid");
  invariant(JSON.stringify(registry.profiles.map(({ id }) => id)) === JSON.stringify(PROFILE_IDS), "profile registry set or order is invalid");
  invariant(JSON.stringify(profileDefinitions?.profiles?.map(({ id }) => id)) === JSON.stringify(PROFILE_IDS), "profile definitions set or order is invalid");
  for (let index = 0; index < PROFILE_IDS.length; index += 1) {
    const registryProfile = registry.profiles[index];
    const definitionProfile = profileDefinitions.profiles[index];
    invariant(registryProfile.backend === definitionProfile.backend && registryProfile.storage === definitionProfile.storage,
      `profile definition mismatch for ${registryProfile.id}`);
    validateProfileEntry(registryProfile, definitionProfile);
  }
  invariant(buildUnits?.units && typeof buildUnits.units === "object", "build-unit input is invalid");
  for (const config of Object.values(PROFILE_INPUT)) {
    for (const unit of config.buildUnits) invariant(typeof buildUnits.units[unit]?.deploymentEligible === "boolean", `build unit ${unit} is invalid`);
  }
  invariant(eaclLock?.repository === "https://github.com/theronic/eacl.git" && SHA1.test(eaclLock.sha), "EACL lock input is invalid");
  invariant(Array.isArray(fixtureManifests) && JSON.stringify(fixtureManifests.map((value) => value.cutPoint.logicalResources)) === JSON.stringify([10000, 1000000]),
    "fixture manifests must be the exact 10,000 and 1,000,000 resource set");
  for (const fixture of fixtureManifests) fixtureIdentity(fixture);
  validateBenchmarkInputs(registry.benchmarkEvidence, benchmarkEvidenceRecords);
  invariant(sources && typeof sources === "object" && !Array.isArray(sources), "release report sources are invalid");
  for (const path of [
    "dependencies/eacl-core.lock.json",
    "infra/observability/profile-runtime.yaml",
    "infra/observability/template.yaml",
    "infra/data/dynamodb-cost-controls.yaml",
    "infra/data/dynamodb-cap-policy.v1.json",
    ...SERVER_PROFILE_IDS.map((id) => PROFILE_INPUT[id].runtimeDefinition)
  ]) invariant(typeof sources[path] === "string" && sources[path].length > 0, `release report source ${path} is missing`);
}

function validateBenchmarkInputs(summaries, records) {
  invariant(Array.isArray(summaries) && Array.isArray(records) && summaries.length === records.length,
    "benchmark evidence summaries must have exact source records");
  for (let index = 0; index < summaries.length; index += 1) {
    const summary = summaries[index];
    const record = records[index];
    exactKeys(record, ["path", "source"], "benchmark evidence source record");
    invariant(record.path === summary.path && typeof record.source === "string" && sha256(record.source) === summary.sha256,
      "benchmark evidence source identity does not match its summary");
    let evidence;
    try {
      evidence = JSON.parse(record.source);
    } catch {
      throw new TypeError("benchmark evidence source is not JSON");
    }
    validateFastestEvidence(evidence);
    invariant(evidence.evidenceId === summary.evidenceId && evidence.backend === summary.backend
      && JSON.stringify(evidence.profiles) === JSON.stringify(summary.profiles)
      && evidence.measuredAt === summary.measuredAt && evidence.expiresAt === summary.expiresAt,
    "benchmark evidence content does not match its summary");
  }
}

function validateSource(source, reportState) {
  exactKeys(source, ["demo", "eacl"], "release source");
  exactKeys(source.demo, ["repository", "sha", "status", "reason"], "demo source");
  exactKeys(source.eacl, ["repository", "sha", "status", "reason", "lock"], "EACL source");
  invariant(source.demo.repository === "https://github.com/theronic/eacl-demo.git", "demo source repository is invalid");
  invariant(source.eacl.repository === "https://github.com/theronic/eacl.git" && SHA1.test(source.eacl.sha), "EACL source identity is invalid");
  validateDefinition(source.eacl.lock);
  invariant(source.eacl.lock.path === "dependencies/eacl-core.lock.json", "EACL lock definition path is invalid");
  if (reportState === "pre-release") {
    invariant(source.demo.sha === null && source.demo.status === "uncommitted" && nonempty(source.demo.reason), "pre-release report-build source must be unresolved");
    invariant(source.eacl.status === "locked" && source.eacl.reason === null, "pre-release EACL source must be locked");
  } else {
    invariant(SHA1.test(source.demo.sha) && source.demo.status === "committed" && source.demo.reason === null, "released report-build source is invalid");
    invariant(source.eacl.status === "locked" && source.eacl.reason === null, "released EACL lock source is invalid");
  }
}

function validateRelease(release, reportState, source) {
  if (reportState === "pre-release") {
    invariant(release === null, "pre-release report cannot claim a release identity");
    return;
  }
  exactKeys(release, ["deploymentIdentity", "releaseManifestSha256", "publishedAt"], "release identity");
  invariant(/^1345904214:[1-9][0-9]*:[1-9][0-9]*:[0-9a-f]{40}$/u.test(release.deploymentIdentity)
    && SHA256.test(release.releaseManifestSha256) && validTimestamp(release.publishedAt), "release identity is invalid");
  invariant(release.deploymentIdentity.endsWith(`:${source.demo.sha}`), "release identity does not bind the demo source");
}

function validateBenchmarkEvidence(evidence) {
  invariant(Array.isArray(evidence), "benchmark evidence must be an array");
  const ids = new Set();
  for (const summary of evidence) {
    exactKeys(summary, ["evidenceId", "backend", "profiles", "measuredAt", "expiresAt", "path", "sha256"], "benchmark evidence summary");
    invariant(DIGEST.test(summary.evidenceId) && !ids.has(summary.evidenceId), "benchmark evidence identity is invalid or duplicated");
    ids.add(summary.evidenceId);
    invariant(BACKENDS.includes(summary.backend) && Array.isArray(summary.profiles) && summary.profiles.length >= 2
      && summary.profiles.every((id) => PROFILE_INPUT[id]?.backend === summary.backend)
      && new Set(summary.profiles).size === summary.profiles.length, "benchmark evidence profile scope is invalid");
    invariant(validTimestamp(summary.measuredAt) && validTimestamp(summary.expiresAt)
      && Date.parse(summary.expiresAt) > Date.parse(summary.measuredAt), "benchmark evidence validity window is invalid");
    invariant(/^registry\/benchmark-evidence\/[a-z0-9._/-]+\.json$/u.test(summary.path) && SHA256.test(summary.sha256),
      "benchmark evidence repository identity is invalid");
  }
}

function validateStorageDefaults(defaults, benchmarkEvidence) {
  invariant(Array.isArray(defaults) && defaults.length === BACKENDS.length, "storage defaults must cover every backend");
  invariant(JSON.stringify(defaults.map(({ backend }) => backend)) === JSON.stringify(BACKENDS), "storage default backend order is invalid");
  const evidenceById = new Map(benchmarkEvidence.map((summary) => [summary.evidenceId, summary]));
  for (const value of defaults) {
    exactKeys(value, ["outcome", "profileId", "storage", "claim", "evidenceId", "measuredAt", "reason", "backend"], `storage default ${value.backend}`);
    invariant(new Set(["none", "sole-qualified", "fallback", "winner", "benchmark-tiebreak"]).has(value.outcome), "storage default outcome is invalid");
    if (new Set(["winner", "benchmark-tiebreak"]).has(value.outcome)) {
      invariant(DIGEST.test(value.evidenceId) && validTimestamp(value.measuredAt) && value.claim !== null, "performance-selected storage default lacks evidence");
      const evidence = evidenceById.get(value.evidenceId);
      invariant(evidence && evidence.backend === value.backend && evidence.profiles.includes(value.profileId)
        && evidence.measuredAt === value.measuredAt, "storage default evidence summary does not match the selection");
      invariant(value.claim === (value.outcome === "winner" ? "fastest-qualified" : "benchmark-selected"),
        "storage default performance claim does not match its outcome");
    } else {
      invariant(value.claim === null && value.evidenceId === null && value.measuredAt === null,
        "non-benchmark storage default cannot claim performance evidence");
    }
    if (value.outcome === "none") invariant(value.profileId === null && value.storage === null && nonempty(value.reason), "empty storage default is incomplete");
    else {
      const profile = PROFILE_INPUT[value.profileId];
      invariant(profile?.backend === value.backend && profile.storage === value.storage, "storage default profile mapping is invalid");
      if (new Set(["sole-qualified", "fallback"]).has(value.outcome)) invariant(nonempty(value.reason), "non-benchmark storage selection lacks a reason");
      else invariant(value.reason === null, "benchmark storage selection cannot carry a fallback reason");
    }
  }
}

function validateFixtures(fixtures) {
  invariant(Array.isArray(fixtures) && JSON.stringify(fixtures.map(({ logicalResources }) => logicalResources)) === JSON.stringify([10000, 1000000]),
    "release fixtures must be the exact semantic-prefix pair");
  for (const fixture of fixtures) {
    exactKeys(fixture, ["fixtureId", "logicalResources", "manifestSha256", "fixtureSha256", "semanticRecordsSha256", "path"], "release fixture");
    invariant(fixture.fixtureId === "eacl-demo-fixture-v1" && DIGEST.test(fixture.manifestSha256)
      && DIGEST.test(fixture.fixtureSha256) && DIGEST.test(fixture.semanticRecordsSha256), "release fixture identity is invalid");
    invariant(fixture.path === `fixtures/manifests/fixture-${fixture.logicalResources}.v1.json`, "release fixture path is invalid");
  }
}

function validateProfiles(profiles, report) {
  invariant(Array.isArray(profiles) && JSON.stringify(profiles.map(({ id }) => id)) === JSON.stringify(PROFILE_IDS), "release profiles must be the exact closed set");
  const fixtures = new Map(report.fixtures.map((fixture) => [fixture.logicalResources, fixture]));
  for (const profile of profiles) {
    exactKeys(profile, [
      "id", "backend", "storage", "route", "availabilityState", "availabilityReason", "buildUnits",
      "deploymentEligible", "deployment", "lastOutcome", "fixture", "runtime", "memory", "alarms", "rollback"
    ], `release profile ${profile.id}`);
    invariant(PROFILE_ID.test(profile.id) && PROFILE_INPUT[profile.id], "release profile ID is invalid");
    const expected = PROFILE_INPUT[profile.id];
    invariant(profile.backend === expected.backend && profile.storage === expected.storage && profile.route === expected.route,
      `release profile mapping for ${profile.id} is invalid`);
    invariant(new Set(["enabled", "disabled", "qualifying", "unavailable"]).has(profile.availabilityState), "profile availability is invalid");
    invariant(Array.isArray(profile.buildUnits) && JSON.stringify(profile.buildUnits) === JSON.stringify(PROFILE_INPUT[profile.id].buildUnits), "profile build units are invalid");
    invariant(typeof profile.deploymentEligible === "boolean", "profile deployment eligibility is invalid");
    validateOutcome(profile.lastOutcome);
    validateDeployment(profile.deployment, profile.id);
    if (profile.deployment !== null && profile.lastOutcome.outcome === "never-deployed") throw new TypeError("deployed profile cannot have a never-deployed outcome");
    if (profile.lastOutcome.outcome === "succeeded") {
      invariant(profile.deployment !== null
        && profile.lastOutcome.attemptedDemoSha === profile.deployment.demoSha
        && profile.lastOutcome.attemptedEaclSha === profile.deployment.eaclSha
        && profile.lastOutcome.artifactSha256 === profile.deployment.artifact.sha256,
      "successful profile outcome does not match the active deployment");
    }
    validateRuntime(profile.runtime, profile.id);
    validateMemory(profile.memory, profile.id);
    validateAlarms(profile.alarms, profile.id);
    validateRollback(profile.rollback, profile.id);
    if (profile.rollback.status === "ready") invariant(report.reportState === "released" && profile.deployment !== null,
      "ready rollback coordinates do not belong to a deployed release");
    const fixture = fixtures.get(profile.fixture.logicalResources);
    invariant(fixture && profile.fixture.fixtureId === fixture.fixtureId && profile.fixture.manifestSha256 === fixture.manifestSha256,
      "profile fixture identity is not in the release fixture set");
    invariant(profile.fixture.logicalResources === expected.fixtureResources, `profile fixture scale for ${profile.id} is invalid`);
    if (profile.availabilityState === "enabled") {
      invariant(report.reportState === "released" && profile.availabilityReason === null && profile.deploymentEligible === true,
        "enabled profile is not release eligible");
      invariant(profile.deployment !== null, "enabled profile lacks an immutable deployment");
      invariant(profile.memory.status === "qualified" || profile.memory.status === "browser-managed", "enabled profile memory is unqualified");
      invariant(profile.alarms.status === "verified" || profile.alarms.status === "not-applicable", "enabled profile alarms are unverified");
      invariant(profile.rollback.status === "ready", "enabled profile lacks rollback coordinates");
    } else invariant(nonempty(profile.availabilityReason), "non-enabled profile lacks a reason");
  }
  if (report.reportState === "released") invariant(profiles.some(({ availabilityState }) => availabilityState === "enabled"),
    "released report must contain at least one enabled profile");
  if (profiles.some(({ availabilityState, storage }) => availabilityState === "enabled" && storage === "dynamodb")) {
    invariant(report.costControls.status === "verified" && report.costControls.dynamodb.status === "verified"
      && report.costControls.notifications.status === "verified", "enabled DynamoDB profile lacks verified cost notification controls");
  }
}

function validateRuntime(runtime, profileId) {
  exactKeys(runtime, ["name", "architecture", "snapStart"], `runtime ${profileId}`);
  const expected = PROFILE_INPUT[profileId];
  invariant(runtime.name === expected.runtime && runtime.architecture === expected.architecture && runtime.snapStart === expected.snapStart,
    `runtime declaration for ${profileId} is invalid`);
}

function validateMemory(memory, profileId) {
  exactKeys(memory, ["status", "configuredMiB", "qualifiedMiB", "evidenceId", "definition"], `memory ${profileId}`);
  if (memory.status === "browser-managed") {
    invariant(profileId === "datascript-browser-memory" && memory.configuredMiB === null && memory.qualifiedMiB === null && memory.evidenceId === null && memory.definition === null,
      "browser-managed memory declaration is invalid");
  } else if (memory.status === "candidate-unqualified") {
    invariant(Number.isSafeInteger(memory.configuredMiB) && memory.configuredMiB >= 128 && memory.qualifiedMiB === null && memory.evidenceId === null,
      "candidate memory declaration is invalid");
    validateDefinition(memory.definition);
    invariant(memory.definition.path === PROFILE_INPUT[profileId].runtimeDefinition, "candidate memory definition path is invalid");
  } else if (memory.status === "qualified") {
    invariant(Number.isSafeInteger(memory.configuredMiB) && memory.configuredMiB === memory.qualifiedMiB && DIGEST.test(memory.evidenceId),
      "qualified memory declaration lacks exact evidence");
    validateDefinition(memory.definition);
    invariant(memory.definition.path === PROFILE_INPUT[profileId].runtimeDefinition, "qualified memory definition path is invalid");
  } else throw new TypeError("memory status is invalid");
}

function validateAlarms(alarms, profileId) {
  exactKeys(alarms, ["status", "count", "definition", "evidenceId", "reason"], `alarms ${profileId}`);
  if (alarms.status === "not-applicable") {
    invariant(profileId === "datascript-browser-memory" && alarms.count === 0 && alarms.definition === null && alarms.evidenceId === null && nonempty(alarms.reason),
      "not-applicable alarm declaration is invalid");
  } else {
    invariant(SERVER_PROFILE_IDS.includes(profileId) && alarms.count === 7, "server alarm count is invalid");
    validateDefinition(alarms.definition);
    invariant(alarms.definition.path === "infra/observability/profile-runtime.yaml", "profile alarm definition path is invalid");
    if (alarms.status === "verified") invariant(DIGEST.test(alarms.evidenceId) && alarms.reason === null, "verified alarms lack readiness evidence");
    else invariant(alarms.status === "defined-not-deployed" && alarms.evidenceId === null && nonempty(alarms.reason), "unverified alarms are overstated");
  }
}

function validateRollback(rollback, profileId) {
  exactKeys(rollback, ["status", "kind", "alias", "statusObject", "static", "reason"], `rollback ${profileId}`);
  if (rollback.status === "unavailable") {
    invariant(rollback.kind === null && rollback.alias === null && rollback.statusObject === null && rollback.static === null && nonempty(rollback.reason),
      "unavailable rollback carries unsupported coordinates");
    return;
  }
  invariant(rollback.status === "ready" && rollback.reason === null, "rollback status is invalid");
  if (rollback.kind === "lambda-alias-and-versioned-status") {
    exactKeys(rollback.alias, ["functionName", "aliasName", "currentVersion", "revisionId", "restoreVersion"], `rollback alias ${profileId}`);
    exactKeys(rollback.statusObject, ["bucket", "key", "etag", "versionId", "publicationId"], `rollback status object ${profileId}`);
    invariant(SERVER_PROFILE_IDS.includes(profileId) && rollback.static === null && nonempty(rollback.alias.revisionId)
      && /^[1-9][0-9]*$/u.test(rollback.alias.currentVersion) && /^[1-9][0-9]*$/u.test(rollback.alias.restoreVersion)
      && rollback.alias.currentVersion !== rollback.alias.restoreVersion && rollback.statusObject.key === `registry/profiles/${profileId}.json`
      && /^"?[0-9a-f]{32}(?:-[1-9][0-9]*)?"?$/u.test(rollback.statusObject.etag)
      && nonempty(rollback.statusObject.versionId) && DIGEST.test(rollback.statusObject.publicationId), "Lambda rollback coordinates are incomplete");
  } else if (rollback.kind === "static-versioned-prefix") {
    exactKeys(rollback.static, ["bucket", "activePrefix", "restorePrefix", "distributionId"], `static rollback ${profileId}`);
    invariant(profileId === "datascript-browser-memory" && rollback.alias === null && rollback.statusObject === null && nonempty(rollback.static.bucket)
      && rollback.static.activePrefix !== rollback.static.restorePrefix && nonempty(rollback.static.distributionId), "static rollback coordinates are incomplete");
  } else throw new TypeError("rollback kind is invalid");
}

function validateCostControls(costControls) {
  exactKeys(costControls, ["status", "dynamodb", "budgets", "anomalyDetection", "notifications"], "cost controls");
  invariant(new Set(["defined-not-deployed", "verified"]).has(costControls.status), "cost-control status is invalid");
  exactKeys(costControls.dynamodb, ["status", "alarmCountPerTable", "definition", "policy", "profiles", "evidenceId"], "DynamoDB cost controls");
  invariant(costControls.dynamodb.alarmCountPerTable === 9 && costControls.dynamodb.profiles.length === 2, "DynamoDB cost controls are incomplete");
  validateDefinition(costControls.dynamodb.definition);
  validateDefinition(costControls.dynamodb.policy);
  invariant(costControls.dynamodb.definition.path === "infra/data/dynamodb-cost-controls.yaml"
    && costControls.dynamodb.policy.path === "infra/data/dynamodb-cap-policy.v1.json", "DynamoDB control definition paths are invalid");
  for (const entry of costControls.dynamodb.profiles) {
    exactKeys(entry, ["profileId", "seed", "serving"], `DynamoDB caps ${entry.profileId}`);
    invariant(new Set(["datahike-dynamodb", "datomic-dynamodb"]).has(entry.profileId), "DynamoDB cap profile is invalid");
    for (const phase of [entry.seed, entry.serving]) {
      exactKeys(phase, ["maxReadRequestUnits", "maxWriteRequestUnits"], "DynamoDB cap phase");
      invariant(Number.isSafeInteger(phase.maxReadRequestUnits) && Number.isSafeInteger(phase.maxWriteRequestUnits), "DynamoDB caps are invalid");
    }
  }
  validateEvidenceStatus(costControls.dynamodb);
  invariant(Array.isArray(costControls.budgets) && JSON.stringify(costControls.budgets.map(({ id }) => id)) === JSON.stringify(["monthly-project", "seed"]), "budget set is invalid");
  for (const budget of costControls.budgets) {
    exactKeys(budget, ["id", "amountUsd", "thresholdsPercent", "filter", "status", "definition", "evidenceId"], `budget ${budget.id}`);
    invariant(Number.isFinite(budget.amountUsd) && budget.amountUsd > 0 && JSON.stringify(budget.thresholdsPercent) === JSON.stringify([50, 80, 100]), "budget values are invalid");
    validateDefinition(budget.definition);
    invariant(budget.definition.path === "infra/observability/template.yaml", "budget definition path is invalid");
    validateEvidenceStatus(budget);
  }
  exactKeys(costControls.anomalyDetection, ["thresholdUsd", "status", "definition", "evidenceId"], "cost anomaly detection");
  invariant(Number.isFinite(costControls.anomalyDetection.thresholdUsd) && costControls.anomalyDetection.thresholdUsd > 0, "cost anomaly threshold is invalid");
  validateDefinition(costControls.anomalyDetection.definition);
  invariant(costControls.anomalyDetection.definition.path === "infra/observability/template.yaml", "cost anomaly definition path is invalid");
  validateEvidenceStatus(costControls.anomalyDetection);
  exactKeys(costControls.notifications, ["channel", "status", "definition", "evidenceId", "reason"], "cost notifications");
  invariant(costControls.notifications.channel === "telegram", "notification channel is invalid");
  validateDefinition(costControls.notifications.definition);
  invariant(costControls.notifications.definition.path === "infra/observability/template.yaml", "notification definition path is invalid");
  if (costControls.notifications.status === "verified") invariant(DIGEST.test(costControls.notifications.evidenceId) && costControls.notifications.reason === null, "verified notification path lacks evidence");
  else invariant(costControls.notifications.status === "defined-not-verified" && costControls.notifications.evidenceId === null && nonempty(costControls.notifications.reason), "notification path is overstated");
  const allVerified = costControls.dynamodb.status === "verified"
    && costControls.budgets.every(({ status }) => status === "verified")
    && costControls.anomalyDetection.status === "verified"
    && costControls.notifications.status === "verified";
  const noneVerified = costControls.dynamodb.status === "defined-not-deployed"
    && costControls.budgets.every(({ status }) => status === "defined-not-deployed")
    && costControls.anomalyDetection.status === "defined-not-deployed"
    && costControls.notifications.status === "defined-not-verified";
  invariant(costControls.status === "verified" ? allVerified : noneVerified, "aggregate cost-control status does not match its evidence");
}

function validateEvidenceStatus(value) {
  if (value.status === "verified") invariant(DIGEST.test(value.evidenceId), "verified control lacks evidence");
  else invariant(value.status === "defined-not-deployed" && value.evidenceId === null, "local control definition is overstated");
}

function validateBlockers(blockers, reportState) {
  invariant(Array.isArray(blockers), "release blockers must be an array");
  if (reportState === "released") invariant(blockers.length === 0, "released report cannot retain blockers");
  else invariant(blockers.length > 0, "pre-release report must name its blockers");
  const codes = new Set();
  for (const blocker of blockers) {
    exactKeys(blocker, ["code", "profiles", "reason", "requiredEvidence"], "release blocker");
    invariant(PROFILE_ID.test(blocker.code) && !codes.has(blocker.code), "release blocker code is invalid or duplicated");
    codes.add(blocker.code);
    invariant(Array.isArray(blocker.profiles) && blocker.profiles.every((id) => PROFILE_IDS.includes(id))
      && new Set(blocker.profiles).size === blocker.profiles.length, "release blocker profile scope is invalid");
    invariant(nonempty(blocker.reason) && nonempty(blocker.requiredEvidence), "release blocker is incomplete");
  }
}

function validateDeployment(deployment, profileId) {
  if (deployment === null) return;
  exactKeys(deployment, ["demoSha", "eaclSha", "artifact", "deploymentId", "dataManifestSha256", "deployedAt"], "profile deployment");
  exactKeys(deployment.artifact, ["kind", "sha256", "version"], "profile artifact");
  invariant(SHA1.test(deployment.demoSha) && SHA1.test(deployment.eaclSha) && SHA256.test(deployment.artifact.sha256)
    && SHA256.test(deployment.dataManifestSha256) && nonempty(deployment.artifact.version) && nonempty(deployment.deploymentId)
    && validTimestamp(deployment.deployedAt), "profile deployment identity is invalid");
  if (profileId === "datascript-browser-memory") invariant(deployment.artifact.kind === "static", "DataScript deployment artifact kind is invalid");
  else invariant(deployment.artifact.kind === "lambda-version" && /^[1-9][0-9]*$/u.test(deployment.artifact.version),
    "server deployment must use an immutable numbered Lambda version");
}

function validateOutcome(outcome) {
  exactKeys(outcome, ["outcome", "attemptedDemoSha", "attemptedEaclSha", "artifactSha256", "at", "message"], "profile outcome");
  invariant(new Set(["never-deployed", "succeeded", "failed", "rolled-back"]).has(outcome.outcome) && nonempty(outcome.message), "profile outcome is invalid");
  if (outcome.outcome === "never-deployed") invariant(outcome.attemptedDemoSha === null && outcome.attemptedEaclSha === null && outcome.artifactSha256 === null && outcome.at === null, "never-deployed outcome carries an identity");
  else invariant(SHA1.test(outcome.attemptedDemoSha) && SHA1.test(outcome.attemptedEaclSha) && SHA256.test(outcome.artifactSha256) && validTimestamp(outcome.at), "profile outcome identity is invalid");
}

function fixtureIdentity(fixture) {
  invariant(fixture?.fixtureId === "eacl-demo-fixture-v1" && new Set([10000, 1000000]).has(fixture.cutPoint?.logicalResources)
    && DIGEST.test(fixture.digests?.manifest) && DIGEST.test(fixture.digests?.fixture)
    && DIGEST.test(fixture.digests?.semanticRecords), "fixture manifest identity is invalid");
  const payload = structuredClone(fixture);
  const claimed = payload.digests.manifest;
  delete payload.digests.manifest;
  invariant(claimed === `sha256:${sha256(`${canonicalJson(payload)}\n`)}`, "fixture manifest self-digest is invalid");
  return {
    fixtureId: fixture.fixtureId,
    logicalResources: fixture.cutPoint.logicalResources,
    manifestSha256: fixture.digests.manifest
  };
}

function definition(path, sources) {
  invariant(DEFINITION_PATH.test(path) && typeof sources[path] === "string", `definition ${path} is invalid`);
  return { path, sha256: sha256(sources[path]) };
}

function validateDefinition(value) {
  exactKeys(value, ["path", "sha256"], "definition reference");
  invariant(DEFINITION_PATH.test(value.path) && SHA256.test(value.sha256), "definition reference is invalid");
}

function memoryDefault(source) {
  const matches = [...source.matchAll(/^  MemorySize:\n(?:    .*\n)*?    Default: ([0-9]+)$/gmu)];
  invariant(matches.length === 1, "runtime template must contain exactly one candidate memory default");
  return Number(matches[0][1]);
}

function parameterDefault(source, parameter) {
  const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = [...source.matchAll(new RegExp(`^  ${escaped}:\\n(?:    .*\\n)*?    Default: ([0-9]+)$`, "gmu"))];
  invariant(matches.length === 1, `template parameter ${parameter} must have exactly one numeric default`);
  return Number(matches[0][1]);
}

function validateRuntimeDefinition(source, config) {
  for (const marker of [
    `    Runtime: ${config.runtime}`,
    `    Architecture: ${config.architecture}`,
    `      Runtime: ${config.runtime}`,
    `        - ${config.architecture}`
  ]) invariant(source.includes(marker), `runtime definition lacks ${marker.trim()}`);
  const snapStartProperty = /^      SnapStart:\n        ApplyOn: (None|PublishedVersions)$/mu.exec(source)?.[1] ?? null;
  if (config.snapStart === "enabled") invariant(snapStartProperty === "PublishedVersions", "SnapStart-enabled runtime definition is invalid");
  else if (config.snapStart === "disabled") invariant(snapStartProperty === "None", "SnapStart-disabled runtime definition is invalid");
  else invariant(config.snapStart === "unsupported" && snapStartProperty === null, "SnapStart-unsupported runtime must omit the function property");
}

function yamlTopLevelBlock(source, name) {
  const header = `  ${name}:\n`;
  const start = source.indexOf(header);
  invariant(start >= 0 && (start === 0 || source[start - 1] === "\n"), `YAML definition lacks ${name}`);
  const contentStart = start + header.length;
  const rest = source.slice(contentStart);
  const next = rest.search(/^  [A-Za-z][A-Za-z0-9]*:\n/mu);
  return source.slice(start, next < 0 ? source.length : contentStart + next);
}

function count(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function contentId(report) {
  const value = structuredClone(report);
  delete value.reportId;
  return `sha256:${sha256(canonicalJson(value))}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && !Number.isNaN(Date.parse(value));
}

function nonempty(value) {
  return typeof value === "string" && value.length > 0;
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  invariant(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} keys are invalid`);
}

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}
