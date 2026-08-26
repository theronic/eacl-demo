export type ProfilePhase = "idle" | "switching" | "ready" | "error" | "canceled" | "closed";
export type ProfileAvailability = "enabled" | "disabled" | "qualifying" | "unavailable";
export type Scalar = string | number | boolean | null;

export interface BackendOption {
  id: string;
  label: string;
}

export interface StorageChoice {
  id: string;
  storage: string;
  label: string;
  state: ProfileAvailability;
  reason: string | null;
  selectable: boolean;
  deployment?: DeploymentIdentity | null;
  lastOutcome?: DeploymentOutcome;
}

export interface DeploymentIdentity {
  demoSha: string;
  eaclSha: string;
  artifact: { kind: "static" | "lambda-version" | "browser-worker"; sha256: string; version: string };
  deploymentId: string;
  dataManifestSha256: string;
  deployedAt: string;
}

export interface DeploymentOutcome {
  outcome: "never-deployed" | "succeeded" | "failed" | "rolled-back";
  attemptedDemoSha: string | null;
  attemptedEaclSha: string | null;
  artifactSha256: string | null;
  at: string | null;
  message: string;
}

export interface ExplorerObject {
  type: string;
  id: string;
  displayName: string | null;
  attributes: Array<{ name: string; value: Scalar }>;
}

export interface ExplorerRelationship {
  resourceType: string;
  resourceId: string;
  relation: string;
  subjectType: string;
  subjectId: string;
  subjectRelation: string | null;
}

export interface ExplorerSchema {
  sha256: string;
  types: Array<{
    name: string;
    relations: Array<{ name: string; subjectTypes: string[] }>;
    permissions: Array<{ name: string; expression: string }>;
  }>;
}

export interface CacheInfo {
  behavior: string;
  hit: boolean | null;
  scope: string;
  entries: number | null;
  limitations: string[];
}

export interface AuthorizationDecision {
  subjectType: string;
  subjectId: string;
  resourceType: string;
  resourceId: string;
  permission: string;
  allowed: boolean;
  reasonCode: string;
  path: Array<{ kind: string; label: string; allowed: boolean }>;
}

export interface ExplorerMetadata {
  profileId: string;
  backend: string;
  storage: string;
  runtime: string;
  demoSha: string;
  eaclSha: string;
  artifactSha256: string;
  deploymentId: string;
  fixtureId: string;
  dataManifestSha256: string;
  basisId: string;
}

export interface DescriptorNotice {
  id: string;
  label: string;
  description: string;
}
