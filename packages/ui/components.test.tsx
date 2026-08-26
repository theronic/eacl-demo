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
  ProfileSelector
} from "./src/components";

describe("shared explorer component states", () => {
  it("keeps unavailable storage visible but presents only the product selector", () => {
    const choices = [
      { id: "datahike-s3", storage: "s3", label: "S3", state: "enabled" as const, reason: null, selectable: true },
      { id: "datahike-dynamodb", storage: "dynamodb", label: "DynamoDB", state: "unavailable" as const, reason: "The table generation is not published.", selectable: false }
    ];
    const html = renderToString(() => <ProfileSelector backends={[{ id: "datahike", label: "Datahike" }]} backend="datahike" storage="s3" storageChoices={choices} onBackend={() => {}} onStorage={() => {}} />);
    expect(html).toContain("DynamoDB");
    expect(html).toMatch(/<option[^>]*value="dynamodb"[^>]*disabled/u);
    expect(html).not.toContain("unavailable");
    expect(html).not.toContain("The table generation is not published.");
    expect(html).not.toContain("Runtime profile");
    expect(html).not.toContain("qualified profiles");
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
