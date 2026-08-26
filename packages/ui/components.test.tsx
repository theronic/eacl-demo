import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { projectDescriptorPresentation } from "../explorer-state/src/descriptor-presentation.mjs";
import { mockCapabilityScenarios } from "../explorer-state/support/mock-transports.mjs";
import {
  ConsistencySelector,
  ErrorState,
  LimitationList,
  LiveAnnouncer,
  LoadingState,
  PanelBoundary,
  ProfileSelector,
  ProfileStatus
} from "./src/components";

describe("shared explorer component states", () => {
  it("keeps unavailable storage visible but disabled with its reason", () => {
    const choices = [
      { id: "datahike-s3", storage: "s3", label: "S3", state: "enabled" as const, reason: null, selectable: true },
      { id: "datahike-dynamodb", storage: "dynamodb", label: "DynamoDB", state: "unavailable" as const, reason: "The table generation is not published.", selectable: false }
    ];
    const html = renderToString(() => <><ProfileSelector backends={[{ id: "datahike", label: "Datahike" }]} backend="datahike" storage="s3" storageChoices={choices} onBackend={() => {}} onStorage={() => {}} /><ProfileStatus backendLabel="Datahike" storageLabel="S3" choices={choices} /></>);
    expect(html).toContain("DynamoDB");
    expect(html).toContain("unavailable");
    expect(html).toMatch(/<option[^>]*value="dynamodb"[^>]*disabled/u);
    expect(html).toContain("The table generation is not published.");
    expect(html).toContain('aria-live="polite"');
  });

  it("shows the active and attempted immutable identities for mixed-generation diagnosis", () => {
    const choice = {
      id: "datahike-s3", storage: "s3", label: "S3", state: "enabled" as const, reason: null, selectable: true,
      deployment: { demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifact: { kind: "lambda-version" as const, sha256: "c".repeat(64), version: "7" }, deploymentId: "deploy-7", dataManifestSha256: "d".repeat(64), deployedAt: "2026-08-25T12:00:00Z" },
      lastOutcome: { outcome: "failed" as const, attemptedDemoSha: "e".repeat(40), attemptedEaclSha: "f".repeat(40), artifactSha256: "1".repeat(64), at: "2026-08-25T12:05:00Z", message: "Candidate smoke failed; the prior deployment remains active." }
    };
    const html = renderToString(() => <ProfileStatus backendLabel="Datahike" storageLabel="S3" choices={[choice]} />);
    for (const value of [choice.deployment.demoSha, choice.deployment.eaclSha, choice.deployment.artifact.sha256, choice.deployment.dataManifestSha256, choice.lastOutcome.attemptedDemoSha, choice.lastOutcome.artifactSha256]) expect(html).toContain(value);
    expect(html).toContain("Last deployment outcome");
    expect(html).toContain("failed");
  });

  it("renders bounded loading, error, and announcement semantics", () => {
    const html = renderToString(() => <>
      <LoadingState label="Initializing selected profile" elapsed="2.4 seconds" onCancel={() => {}} />
      <ErrorState message="The dependency is unavailable." code="dependency-unavailable" retryable onRetry={() => {}} />
      <LiveAnnouncer announcement={{ id: "a-1", politeness: "assertive", message: "Schema failed." }} />
    </>);
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Cancel");
    expect(html).toContain("Retry");
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("Schema failed.");
  });

  it("renders consistency and limitation prose projected from descriptor terms", () => {
    const descriptor = mockCapabilityScenarios.find(({ profile }) => profile.id === "datomic-dynamodb")!.descriptor;
    const presentation = projectDescriptorPresentation(descriptor);
    const html = renderToString(() => <PanelBoundary id="consistency" title="Consistency"><ConsistencySelector modes={presentation.consistency.modes} value={presentation.consistency.defaultMode} onChange={() => {}} limitations={presentation.limitations} /></PanelBoundary>);
    expect(html).toContain("Fixed current snapshot");
    expect(html).toContain("No synchronization");
    expect(html).not.toContain("Exact snapshot");
    expect(html).not.toContain("At least as fresh");
    expect(html).toContain('id="consistency-heading"');
    expect(html).toContain('tabindex="-1"');
  });

  it("does not invent limitation text for an empty descriptor list", () => {
    expect(renderToString(() => <LimitationList limitations={[]} />)).toBe("");
  });
});
