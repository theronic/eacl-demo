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
  assert.match(datalevinSource, /RuntimeAssociation:[\s\S]*datalevin\.jar\.stack[\s\S]*sha256sum --check --strict[\s\S]*EACL_DATALEVIN_DIRECTORY=\/var\/lib\/eacl-demo\/datalevin[\s\S]*MemoryMax=352M[\s\S]*systemctl restart eacl-demo-datalevin\.service/u);
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

test("the Datomic JVM heap and object cache follow the running host and are owned by first boot and every stack update", () => {
  const big = "-Xms1024m -Xmx1024m -XX:\\+UseG1GC -XX:\\+ExitOnOutOfMemoryError -Ddatomic\\.objectCacheMax=576m";
  const small = "-Xms384m -Xmx640m -XX:\\+ExitOnOutOfMemoryError";
  const userData = /UserData:[\s\S]*?(?=\n\s{2}RuntimeArtifactAssociation:)/u.exec(source)?.[0];
  const association = /RuntimeArtifactAssociation:[\s\S]*?(?=\n\s{2}InitializationAlarm:)/u.exec(source)?.[0];
  assert.ok(userData);
  assert.ok(association);
  assert.match(userData, /echo "EACL_RUNTIME_MEMORY_MIB=\$\(\( \( \$\(awk '\/MemTotal\/ \{print \$2\}' \/proc\/meminfo\) \+ 1048575 \) \/ 1048576 \* 1024 \)\)"/u);
  assert.match(userData, new RegExp(`-ge 1900000 \\]; then\\n\\s+echo "EACL_JAVA_OPTS=${big}"\\n\\s+else\\n\\s+echo "EACL_JAVA_OPTS=${small}"`, "u"));
  assert.match(userData, /ExecStart=\/usr\/bin\/java \$EACL_JAVA_OPTS -cp \/opt\/eacl-demo\/function\.jar clojure\.main -m eacl-demo\.datomic-dynamodb\.http-server/u);
  assert.match(userData, /eacl-host-metrics\.json[\s\S]*amazon-cloudwatch-agent-ctl -a append-config/u);
  assert.match(association, /EACL_RUNTIME_MEMORY_MIB=\$\(\( \( \$\(awk '\/MemTotal\/ \{print \$2\}' \/proc\/meminfo\) \+ 1048575 \) \/ 1048576 \* 1024 \)\)/u);
  assert.match(association, new RegExp(`-ge 1900000 \\]; then opts='${big}'; else opts='${small}'; fi; sed -i "s\\|\\^EACL_JAVA_OPTS=\\.\\*\\|EACL_JAVA_OPTS=\\$opts\\|"`, "u"));
  assert.match(association, /s\|\^ExecStart=\.\*\|ExecStart=\/usr\/bin\/java \$EACL_JAVA_OPTS -cp[\s\S]*eacl-host-metrics\.json[\s\S]*append-config[\s\S]*systemctl daemon-reload && systemctl restart eacl-demo-datomic\.service/u);
  assert.doesNotMatch(source, /EACL_RUNTIME_MEMORY_MIB=(?:1024|2048)"/u);
});

test("a stack update never replaces a verified SSM release with the stack's older artifact", () => {
  const association = /RuntimeArtifactAssociation:[\s\S]*?(?=\n\s{2}InitializationAlarm:)/u.exec(source)?.[0];
  assert.ok(association);
  assert.match(association, /installed=\$\(sed -n 's\/\^EACL_ARTIFACT_SHA256=\/\/p' \/etc\/eacl-demo-datomic\.env\); if \[ -n "\$installed" \] && \[ "\$installed" != "\$\{ArtifactSha256\}" \] && echo "\$installed  \/opt\/eacl-demo\/function\.jar" \| sha256sum --check --strict --status; then touch \/etc\/eacl-demo-keep-release; else rm -f \/etc\/eacl-demo-keep-release; fi/u);
  for (const line of association.split("\n").filter((candidate) => /get-object|function\.jar\.next|EACL_ARTIFACT_SHA256=\$|EACL_CORE_SHA=\$|EACL_DEMO_SHA=\$|EACL_DEPLOYMENT_ID=\$/u.test(candidate))) {
    assert.match(line, /test -e \/etc\/eacl-demo-keep-release \|\|/u, line);
  }
  assert.match(association, /sha256sum --check --strict && install -m 0644 \/opt\/eacl-demo\/function\.jar\.next \/opt\/eacl-demo\/function\.jar/u);
});

test("a Datalevin stack update never replaces a verified SSM release or rewrites its release lines", () => {
  const association = /RuntimeAssociation:[\s\S]*?(?=\n\s{2}StatusAlarm:)/u.exec(datalevinSource)?.[0];
  assert.ok(association);
  // A release is verified when the environment file holds each release line
  // once and the installed jar has the sha256 it names. The guard does not
  // ask for a sha256 other than the stack's: consecutive commits often build
  // the same jar, and the later release carries its own commit and deployment.
  assert.match(association, /if \[ -n "\$artifact" \] && \[ -n "\$core" \] && \[ -n "\$demo" \] && \[ -n "\$deployment" \] && \[ "\$\(grep -Ec '\^EACL_\(ARTIFACT_SHA256\|CORE_SHA\|DEMO_SHA\|DEPLOYMENT_ID\)=' \/etc\/eacl-demo-datalevin\.env\)" -eq 4 \] && echo "\$artifact  \/opt\/eacl-demo\/datalevin\.jar" \| sha256sum --check --strict --status; then\n/u);
  // Only the branch taken when nothing verified is installed names the
  // stack's artifact and release parameters, and it checks what it fetched.
  const unverified = /\n( +)else\n([\s\S]*?)\n\1fi\n/u.exec(association)?.[2];
  assert.ok(unverified);
  const elsewhere = association.replace(unverified, "");
  for (const name of ["ArtifactKey", "ArtifactVersion", "ArtifactSha256", "EaclSha", "DemoSha", "DeploymentId"]) {
    assert.ok(unverified.includes(`\${${name}}`), name);
    assert.ok(!elsewhere.includes(`\${${name}}`), name);
  }
  assert.match(unverified, /get-object [^\n]* \/opt\/eacl-demo\/datalevin\.jar\.stack\n\s+echo '\$\{ArtifactSha256\}  \/opt\/eacl-demo\/datalevin\.jar\.stack' \| sha256sum --check --strict\n/u);
  assert.doesNotMatch(elsewhere, /get-object/u);
  // The environment file's release lines are the ones read from it, unless
  // that branch replaced them, and nothing else writes a release line.
  for (const [line, value] of [
    ["EACL_ARTIFACT_SHA256", "artifact"], ["EACL_CORE_SHA", "core"], ["EACL_DEMO_SHA", "demo"], ["EACL_DEPLOYMENT_ID", "deployment"]
  ]) {
    assert.match(elsewhere, new RegExp(`\\n\\s+${value}=\\$\\(installed ${line}\\)\\n`, "u"), line);
    assert.match(elsewhere, new RegExp(`\\n\\s+echo "${line}=\\$${value}"\\n`, "u"), line);
    assert.equal((association.match(new RegExp(`${line}=`, "gu")) ?? []).length, 1, line);
  }
  // The jar, the environment file and the unit are only ever renamed into
  // place, so a hard link to a replaced file is never written through.
  assert.match(association, /mv -f "\$1\.stack" "\$1"\n/u);
  assert.match(association, /\n\s+if \[ -e \/opt\/eacl-demo\/datalevin\.jar\.stack \]; then replace \/opt\/eacl-demo\/datalevin\.jar 0644; fi\n\s+replace \/etc\/eacl-demo-datalevin\.env 0600\n\s+replace \/etc\/systemd\/system\/eacl-demo-datalevin\.service 0644\n/u);
  assert.doesNotMatch(association, />\s*\/etc\/eacl-demo-datalevin\.env(?!\.stack)|>\s*\/etc\/systemd\/system\/eacl-demo-datalevin\.service(?!\.stack)|(?:install|cp|cat|ln)\b[^\n|]*\s\/opt\/eacl-demo\/datalevin\.jar\n/u);
  // The host keeps its cursor key, and the staged file that carries it is
  // private before its first byte is written.
  assert.match(association, /cursor_key=\$\(installed EACL_CURSOR_KEY\)\n[^\n]*\n\s+install -m 0600 \/dev\/null \/etc\/eacl-demo-datalevin\.env\.stack\n\s+\{\n[\s\S]*?\n\s+echo "EACL_CURSOR_KEY=\$cursor_key"\n[\s\S]*?\n\s+\} > \/etc\/eacl-demo-datalevin\.env\.stack\n/u);
  assert.equal((association.match(/\$cursor_key/gu) ?? []).length, 2);
});

test("the Datalevin association restarts the service only after it replaced a file the service starts from", () => {
  const association = /RuntimeAssociation:[\s\S]*?(?=\n\s{2}StatusAlarm:)/u.exec(datalevinSource)?.[0];
  assert.ok(association);
  // `enable --now` leaves a running unit alone, so the health wait would be
  // answered by the old process whatever was just installed.
  assert.doesNotMatch(association, /enable --now/u);
  // The restart is owed from the moment a file is replaced, and the marker
  // that records it is written before the rename and outlives the run.
  assert.match(association, /else\n\s+touch \/run\/eacl-demo-datalevin\.restart-required\n\s+mv -f "\$1\.stack" "\$1"\n/u);
  assert.equal((association.match(/touch \/run\/eacl-demo-datalevin\.restart-required/gu) ?? []).length, 1);
  assert.match(association, /systemctl daemon-reload\n\s+systemctl enable eacl-demo-datalevin\.service\n\s+if \[ -e \/run\/eacl-demo-datalevin\.restart-required \]; then\n[^\n]*\n\s+systemctl restart eacl-demo-datalevin\.service\n\s+rm -f \/run\/eacl-demo-datalevin\.restart-required\n\s+else\n[^\n]*\n\s+systemctl start eacl-demo-datalevin\.service\n\s+fi\n\s+for attempt in \$\(seq 1 180\); do curl --fail --silent http:\/\/127\.0\.0\.1:8081\/health >\/dev\/null && exit 0; sleep 2; done\n\s+systemctl status eacl-demo-datalevin\.service --no-pager\n\s+exit 1$/u);
  assert.equal((association.match(/systemctl restart/gu) ?? []).length, 1);
  // Everything that can fail for a reason of its own comes before the first
  // rename: the download, the staged files and the agent configuration.
  const firstRename = association.indexOf("if [ -e /opt/eacl-demo/datalevin.jar.stack ]; then replace");
  assert.ok(firstRename > 0);
  for (const step of ["aws s3api get-object", "sha256sum --check --strict\n", "} > /etc/eacl-demo-datalevin.env.stack", "<<'SERVICE'", "amazon-cloudwatch-agent-ctl -a fetch-config"]) {
    const found = association.indexOf(step);
    assert.ok(found > 0 && found < firstRename, step);
  }
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
