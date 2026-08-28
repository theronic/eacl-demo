import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../infra/profiles/datomic-dynamodb-ec2.yaml", import.meta.url), "utf8");

test("persistent Datomic may read only immutable artifacts inside its own profile prefix", () => {
  const policy = /PolicyName: exact-runtime-artifact-read[\s\S]*?(?=\n\s{8}- PolicyName:)/u.exec(source)?.[0];
  assert.ok(policy);
  assert.match(policy, /Action: \[s3:GetObject, s3:GetObjectVersion\]/u);
  assert.match(policy, /\$\{ArtifactBucket\}\/artifacts\/datomic-dynamodb\/\*/u);
  assert.doesNotMatch(policy, /s3:(?:ListBucket|PutObject|DeleteObject)|Resource:\s*["']?\*["']?/u);
});

test("the SSM release association and runtime command both verify the artifact before restart", () => {
  assert.match(source, /RuntimeArtifactAssociation:[\s\S]*get-object[\s\S]*--version-id[\s\S]*sha256sum --check --strict[\s\S]*systemctl restart eacl-demo-datomic\.service/u);
});
