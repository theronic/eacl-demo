import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifestUrl = new URL("infra/deployment/github-oidc-authorities.v1.json", root);
const generatedUrl = new URL("infra/deployment/generated/github-oidc-trust-policies.v1.json", root);
const EXACT_CONDITION_KEYS = [
  "token.actions.githubusercontent.com:aud",
  "token.actions.githubusercontent.com:environment",
  "token.actions.githubusercontent.com:ref",
  "token.actions.githubusercontent.com:repository",
  "token.actions.githubusercontent.com:repository_id",
  "token.actions.githubusercontent.com:repository_owner_id",
  "token.actions.githubusercontent.com:sub",
  "token.actions.githubusercontent.com:workflow"
].sort();
const ACTIVE_DEPLOYMENT_ACTIVATION = "every-main-push";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const unique = (values, label) => {
  assert(new Set(values).size === values.length, `${label} must be unique`);
};

export const workflowRef = (manifest, authority) =>
  `${manifest.repository.fullName}/${authority.workflowFile}@${manifest.repository.deploymentRef}`;

export const customSubject = (manifest, authority) => [
  manifest.repository.immutableSubjectPrefix,
  "ref",
  manifest.repository.deploymentRef,
  "workflow_ref",
  workflowRef(manifest, authority),
  "environment",
  authority.environment,
  "event_name",
  authority.eventName,
  "runner_environment",
  authority.runnerEnvironment
].join(":");

export const defaultEnvironmentSubject = (manifest, authority) =>
  `${manifest.repository.immutableSubjectPrefix}:environment:${authority.environment}`;

export function validateManifest(manifest) {
  assert(manifest?.schema === "eacl-demo.github-oidc-authorities.v1", "unexpected OIDC authority schema");
  assert(/^\d{12}$/u.test(manifest.accountId), "accountId must be exact");
  assert(manifest.providerArn === `arn:aws:iam::${manifest.accountId}:oidc-provider/token.actions.githubusercontent.com`, "provider ARN does not match the account");
  assert(manifest.issuer === "https://token.actions.githubusercontent.com", "issuer must be GitHub Actions");
  assert(manifest.audience === "sts.amazonaws.com", "audience must be AWS STS");
  assert(manifest.repository?.owner === "theronic", "repository owner changed");
  assert(manifest.repository?.ownerId === "1011676", "repository owner ID changed");
  assert(manifest.repository?.name === "eacl-demo", "repository name changed");
  assert(manifest.repository?.repositoryId === "1345904214", "repository ID changed");
  assert(manifest.repository?.fullName === `${manifest.repository.owner}/${manifest.repository.name}`, "repository full name is inconsistent");
  assert(manifest.repository?.deploymentRef === "refs/heads/main", "deployment ref must be exact main");
  assert(manifest.repository?.immutableSubjectPrefix === `repo:${manifest.repository.owner}@${manifest.repository.ownerId}/${manifest.repository.name}@${manifest.repository.repositoryId}`, "immutable subject prefix is inconsistent");
  assert(JSON.stringify(manifest.subjectCustomization) === JSON.stringify({
    use_default: false,
    use_immutable_subject: true,
    include_claim_keys: ["repo", "ref", "workflow_ref", "environment", "event_name", "runner_environment"]
  }), "subject customization must bind immutable repo, ref, workflow_ref, environment, event, and runner in order");
  assert(Array.isArray(manifest.authorities) && manifest.authorities.length > 0, "authorities are required");
  unique(manifest.authorities.map(({ id }) => id), "authority IDs");
  unique(manifest.authorities.map(({ environment }) => environment), "authority environments");
  unique(manifest.authorities.map(({ roleVariable }) => roleVariable), "authority role variables");
  for (const authority of manifest.authorities) {
    assert(/^[a-z0-9][a-z0-9-]+$/u.test(authority.id), `invalid authority ID: ${authority.id}`);
    assert(["ordinary-deployment", "manual-qualification", "manual-transition", "stateful-maintenance"].includes(authority.authorityClass), `invalid authority class: ${authority.id}`);
    assert([ACTIVE_DEPLOYMENT_ACTIVATION, "manual-only-after-workflow-publication"].includes(authority.activation), `invalid activation: ${authority.id}`);
    assert(/^\.github\/workflows\/[a-z0-9-]+\.yml$/u.test(authority.workflowFile), `invalid workflow file: ${authority.id}`);
    assert(typeof authority.workflowName === "string" && authority.workflowName.length > 0, `workflow name missing: ${authority.id}`);
    assert(["push", "workflow_dispatch"].includes(authority.eventName), `invalid event name: ${authority.id}`);
    assert(authority.runnerEnvironment === "github-hosted", `runner environment must be github-hosted: ${authority.id}`);
    assert(/^demo-[a-z0-9-]+$/u.test(authority.environment), `invalid environment: ${authority.id}`);
    assert(/^AWS_[A-Z0-9_]+_ROLE_ARN$/u.test(authority.roleVariable), `invalid role variable: ${authority.id}`);
    assert(typeof authority.permissionScope === "string" && authority.permissionScope.endsWith("only"), `permission scope must be closed: ${authority.id}`);
    assert(!/[?*]/u.test(customSubject(manifest, authority)), `wildcard subject is forbidden: ${authority.id}`);
    if (authority.authorityClass === "ordinary-deployment") {
      assert(authority.workflowFile === ".github/workflows/deploy-demos.yml", `ordinary authority uses another workflow: ${authority.id}`);
      assert(authority.eventName === "push", `ordinary authority is not push-only: ${authority.id}`);
      assert(authority.activation === ACTIVE_DEPLOYMENT_ACTIVATION, `ordinary authority is not active on every main push: ${authority.id}`);
      assert(!/(?:STATEFUL|SEED|MAINTENANCE)/u.test(`${authority.roleVariable}:${authority.permissionScope}`), `ordinary authority crosses stateful boundary: ${authority.id}`);
    } else {
      assert(authority.activation === "manual-only-after-workflow-publication", `nonordinary authority is not manual-only: ${authority.id}`);
      assert(authority.eventName === "workflow_dispatch", `nonordinary authority is not dispatch-only: ${authority.id}`);
    }
  }
  return manifest;
}

export function trustPolicy(manifest, authority) {
  const conditions = {
    "token.actions.githubusercontent.com:aud": manifest.audience,
    "token.actions.githubusercontent.com:environment": authority.environment,
    "token.actions.githubusercontent.com:ref": manifest.repository.deploymentRef,
    "token.actions.githubusercontent.com:repository": manifest.repository.fullName,
    "token.actions.githubusercontent.com:repository_id": manifest.repository.repositoryId,
    "token.actions.githubusercontent.com:repository_owner_id": manifest.repository.ownerId,
    "token.actions.githubusercontent.com:sub": customSubject(manifest, authority),
    "token.actions.githubusercontent.com:workflow": authority.workflowName
  };
  assert(JSON.stringify(Object.keys(conditions).sort()) === JSON.stringify(EXACT_CONDITION_KEYS), "trust condition set drifted");
  return {
    Version: "2012-10-17",
    Statement: [{
      Sid: "ExactGitHubOidcAuthority",
      Effect: "Allow",
      Principal: { Federated: manifest.providerArn },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: { StringEquals: conditions }
    }]
  };
}

export function claimsAllowed(policy, claims) {
  const expected = policy.Statement[0].Condition.StringEquals;
  return Object.entries(expected).every(([key, value]) => claims[key.split(":").at(-1)] === value);
}

export function generatedBundle(manifest) {
  validateManifest(manifest);
  return {
    schema: "eacl-demo.github-oidc-trust-policies.v1",
    sourceSchema: manifest.schema,
    subjectCustomization: manifest.subjectCustomization,
    policies: Object.fromEntries(manifest.authorities.map((authority) => [authority.id, {
      authorityClass: authority.authorityClass,
      activation: authority.activation,
      workflowFile: authority.workflowFile,
      workflowRef: workflowRef(manifest, authority),
      eventName: authority.eventName,
      runnerEnvironment: authority.runnerEnvironment,
      environment: authority.environment,
      roleVariable: authority.roleVariable,
      permissionScope: authority.permissionScope,
      defaultEnvironmentSubjectDuringMigration: defaultEnvironmentSubject(manifest, authority),
      requiredCustomSubject: customSubject(manifest, authority),
      assumeRolePolicyDocument: trustPolicy(manifest, authority)
    }]))
  };
}

export async function loadManifest() {
  return validateManifest(JSON.parse(await readFile(manifestUrl, "utf8")));
}

async function main() {
  const command = process.argv[2] ?? "--check";
  assert(["--check", "--write"].includes(command), "usage: node scripts/github-oidc-policy.mjs [--check|--write]");
  const serialized = `${JSON.stringify(generatedBundle(await loadManifest()), null, 2)}\n`;
  if (command === "--write") {
    await mkdir(new URL(".", generatedUrl), { recursive: true });
    await writeFile(generatedUrl, serialized);
    return;
  }
  const existing = await readFile(generatedUrl, "utf8");
  assert(existing === serialized, "generated OIDC policies are stale; run npm run generate:github-oidc-policies");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
