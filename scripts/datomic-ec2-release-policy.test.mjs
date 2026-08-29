import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, deploySource] = await Promise.all([
  readFile(new URL("../infra/profiles/datomic-dynamodb-ec2.yaml", import.meta.url), "utf8"),
  readFile(new URL("./deploy-live-demo.mjs", import.meta.url), "utf8")
]);

test("the shared persistent host may read only its two immutable profile prefixes", () => {
  const policy = /PolicyName: exact-runtime-artifact-read[\s\S]*?(?=\n\s{8}- PolicyName:)/u.exec(source)?.[0];
  assert.ok(policy);
  assert.match(policy, /Action: \[s3:GetObject, s3:GetObjectVersion\]/u);
  assert.match(policy, /\$\{ArtifactBucket\}\/artifacts\/datomic-dynamodb\/\*/u);
  assert.match(policy, /\$\{ArtifactBucket\}\/artifacts\/datalevin-memory\/\*/u);
  assert.doesNotMatch(policy, /s3:(?:ListBucket|PutObject|DeleteObject)|Resource:\s*["']?\*["']?/u);
});

test("the SSM release association and runtime command both verify the artifact before restart", () => {
  assert.match(source, /RuntimeArtifactAssociation:[\s\S]*get-object[\s\S]*--version-id[\s\S]*sha256sum --check --strict[\s\S]*systemctl restart eacl-demo-datomic\.service/u);
  assert.match(source, /DatalevinRuntimeAssociation:[\s\S]*datalevin\.jar\.next[\s\S]*sha256sum --check --strict[\s\S]*EACL_DATALEVIN_DIRECTORY=\/var\/lib\/eacl-demo\/datalevin[\s\S]*MemoryMax=352M[\s\S]*systemctl enable eacl-demo-datalevin\.service[\s\S]*systemctl restart eacl-demo-datalevin\.service/u);
  assert.match(source, /DatalevinViewerCertificate[\s\S]*HTTPPort: 8081[\s\S]*DatalevinViewerRecord/u);
});

test("one CloudFront prefix-list rule admits both shared-host adapters", () => {
  const ingress = /SecurityGroupIngress:[\s\S]*?(?=\n\s{6}SecurityGroupEgress:)/u.exec(source)?.[0];
  assert.ok(ingress);
  assert.equal((ingress.match(/SourcePrefixListId:/gu) ?? []).length, 1);
  assert.match(ingress, /FromPort: 8080[\s\S]*ToPort: 8081/u);
});

test("the one-vCPU Datomic host admits one engine request and retains spare HTTP workers", () => {
  assert.match(source, /echo "EACL_HTTP_WORKERS=4"/u);
  assert.equal((source.match(/EACL_MAXIMUM_CONCURRENCY=1/gu) ?? []).length, 3);
  assert.doesNotMatch(source, /EACL_MAXIMUM_CONCURRENCY=4/u);
  assert.match(deploySource, /EACL_MAXIMUM_CONCURRENCY=1/u);
  assert.doesNotMatch(deploySource, /EACL_MAXIMUM_CONCURRENCY=4/u);
  assert.match(deploySource, /limit\?\.name === "admissionConcurrency"[\s\S]*admissionConcurrency !== 1/u);
});
