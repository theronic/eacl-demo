import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, deploySource, httpServerSource, depsSource, datalevinSource] = await Promise.all([
  readFile(new URL("../infra/profiles/datomic-dynamodb-ec2.yaml", import.meta.url), "utf8"),
  readFile(new URL("./deploy-live-demo.mjs", import.meta.url), "utf8"),
  readFile(new URL("../services/datomic-dynamodb/src/eacl_demo/datomic_dynamodb/http_server.clj", import.meta.url), "utf8"),
  readFile(new URL("../deps.edn", import.meta.url), "utf8"),
  readFile(new URL("../infra/profiles/datalevin-memory-ec2.yaml", import.meta.url), "utf8")
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
  assert.match(datalevinSource, /RuntimeAssociation:[\s\S]*datalevin\.jar\.next[\s\S]*sha256sum --check --strict[\s\S]*EACL_DATALEVIN_DIRECTORY=\/var\/lib\/eacl-demo\/datalevin[\s\S]*MemoryMax=352M[\s\S]*systemctl enable --now eacl-demo-datalevin\.service/u);
  assert.match(source, /DatalevinViewerCertificate[\s\S]*HTTPPort: 8081[\s\S]*DatalevinViewerRecord/u);
});

test("CloudFront reaches each adapter on its own host", () => {
  const ingress = /SecurityGroupIngress:[\s\S]*?(?=\n\s{6}SecurityGroupEgress:)/u.exec(source)?.[0];
  assert.ok(ingress);
  assert.equal((ingress.match(/SourcePrefixListId:/gu) ?? []).length, 1);
  assert.match(ingress, /FromPort: 8080[\s\S]*ToPort: 8081/u);
});

test("the Datomic t3.small provisions persistent low-swappiness headroom before starting the JVM", () => {
  const userData = /UserData:[\s\S]*?(?=\n\s{2}RuntimeArtifactAssociation:)/u.exec(source)?.[0];
  assert.ok(userData);
  assert.match(source, /InstanceType:\n    Type: String\n    Default: t3\.small\n/u);
  assert.match(source, /InstanceType: t3\.small/u);
  assert.match(userData, /fallocate -l 1G \/swapfile[\s\S]*mkswap \/swapfile/u);
  assert.match(userData, /swapon --show=NAME --noheadings[\s\S]*swapon \/swapfile/u);
  assert.match(userData, /\/swapfile none swap sw 0 0/u);
  assert.match(userData, /vm\.swappiness=10/u);
  assert.match(userData, /vm\.swappiness=10[\s\S]*systemctl enable --now eacl-demo-datomic\.service/u);
});

test("the Datomic JVM heap and object cache are pinned in one env line that first boot and every stack update both own", () => {
  const options = "-Xms1024m -Xmx1024m -XX:\\+UseG1GC -XX:\\+ExitOnOutOfMemoryError -Ddatomic\\.objectCacheMax=576m";
  const userData = /UserData:[\s\S]*?(?=\n\s{2}RuntimeArtifactAssociation:)/u.exec(source)?.[0];
  const association = /RuntimeArtifactAssociation:[\s\S]*?(?=\n\s{2}InitializationAlarm:)/u.exec(source)?.[0];
  assert.ok(userData);
  assert.ok(association);
  assert.match(userData, new RegExp(`echo "EACL_JAVA_OPTS=${options}"`, "u"));
  assert.match(userData, /echo "EACL_RUNTIME_MEMORY_MIB=2048"/u);
  assert.match(userData, /ExecStart=\/usr\/bin\/java \$EACL_JAVA_OPTS -cp \/opt\/eacl-demo\/function\.jar clojure\.main -m eacl-demo\.datomic-dynamodb\.http-server/u);
  assert.doesNotMatch(source, /Xmx640m|Xms384m/u);
  assert.match(association, new RegExp(`EACL_JAVA_OPTS=\\.\\*\\|EACL_JAVA_OPTS=${options}\\|`, "u"));
  assert.match(association, /EACL_RUNTIME_MEMORY_MIB=2048/u);
  assert.match(association, /s\|\^ExecStart=\.\*\|ExecStart=\/usr\/bin\/java \$EACL_JAVA_OPTS -cp[\s\S]*systemctl daemon-reload && systemctl restart eacl-demo-datomic\.service/u);
  assert.match(userData, /"metrics": \{"namespace": "EaclDemo\/Host"[\s\S]*mem_used_percent[\s\S]*swap_used_percent/u);
  assert.match(association, /EaclDemo\/Host[\s\S]*amazon-cloudwatch-agent-ctl -a fetch-config/u);
});

test("Datomic EC2 admits four engine requests while Datalevin keeps its independent limit", () => {
  assert.equal((source.match(/EACL_MAXIMUM_CONCURRENCY=1/gu) ?? []).length, 0);
  assert.match(datalevinSource, /EACL_MAXIMUM_CONCURRENCY=1/u);
  assert.equal((source.match(/EACL_MAXIMUM_CONCURRENCY=4/gu) ?? []).length, 2);
  assert.doesNotMatch(source, /echo "EACL_HTTP_WORKERS=4"/u);
  assert.match(source, /sed -i '\/\^EACL_HTTP_WORKERS=\/d' \/etc\/eacl-demo-datomic\.env/u);
  assert.match(deploySource, /EACL_MAXIMUM_CONCURRENCY=1/u);
  assert.match(deploySource, /EACL_MAXIMUM_CONCURRENCY=4/u);
  assert.match(deploySource, /\/\^EACL_HTTP_WORKERS=\/d/u);
  assert.match(deploySource, /limit\?\.name === "admissionConcurrency"[\s\S]*admissionConcurrency !== 4/u);
  assert.match(depsSource, /http-kit\/http-kit \{:mvn\/version "2\.9\.0-beta4"\}/u);
  assert.match(httpServerSource, /\[org\.httpkit\.server :as http-kit\]/u);
  assert.match(httpServerSource, /:pool-opts \{:allow-virtual\? true\}/u);
  assert.match(httpServerSource, /:max-body \(inc maximum-request-body-bytes\)/u);
  assert.match(httpServerSource, /:server-header nil/u);
  assert.doesNotMatch(httpServerSource, /com\.sun\.net\.httpserver|io\.netty/u);
});

test("deployment proves ordinary Datomic engine contention queues instead of overloading", () => {
  assert.match(deploySource,
    /await smokeDatomicAdmissionQueueUrl\("https:\/\/datomic\.demo\.eacl\.dev"\)/u);
  assert.match(deploySource,
    /async function smokeDatomicAdmissionQueueUrl[\s\S]*requests\.map\(\(request, index\)[\s\S]*status !== 200 \|\| errorCode !== null \|\| data !== true/u);
  for (const operation of [
    "check-permission", "get-object", "list-relationships",
    "reverse-relationships", "list-subjects", "lookup-resources",
    "lookup-subjects", "count-resources", "count-objects", "get-schema",
    "get-cache-info", "bootstrap"
  ]) {
    assert.match(deploySource, new RegExp(`operation: "${operation}"`, "u"));
  }
  assert.match(deploySource,
    /queued \$\{results\.length\} concurrent mixed engine requests without overload/u);
});


test("Datalevin compute and releases never target or restart the Datomic host", () => {
  assert.doesNotMatch(datalevinSource, /eacl-demo-datomic\.service|eacl-demo-datomic\.env|dynamodb:GetItem/u);
  assert.match(datalevinSource, /InstanceType: t3\.micro/u);
  assert.match(source, /DomainName: datalevin-origin\.demo\.eacl\.dev/u);
  assert.doesNotMatch(source, /DatalevinRuntimeAssociation:/u);
  assert.match(deploySource, /deployDatalevinEc2\(release\) \{\n  const instanceId = ec2InstanceId\("DATALEVIN_EC2_INSTANCE_ID"\)/u);
  assert.doesNotMatch(deploySource, /SHARED_EC2_INSTANCE_ID/u);
});

test("the Datahike store cache policy is declared before the deploy dispatch that uses it", () => {
  const declaration = deploySource.indexOf('const DATAHIKE_STORE_CACHE_SIZE = "8000";');
  const dispatch = deploySource.indexOf('if (target === "static") await deployStatic();');
  assert.ok(declaration > 0 && dispatch > 0);
  assert.ok(declaration < dispatch, "top-level dispatch runs before later const declarations initialize");
  assert.match(deploySource, /\.\.\.datahikeStoreCacheEnvironment\(profileId\),/u);
  assert.match(deploySource, /profileId\.startsWith\("datahike-"\)\n\s+\? \{ EACL_STORE_CACHE_SIZE: DATAHIKE_STORE_CACHE_SIZE \}/u);
});
