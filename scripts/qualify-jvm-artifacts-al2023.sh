#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Expected an x86_64 Amazon Linux 2023 container." >&2
  exit 1
fi
if [[ ! -f /workspace/toolchain.json ]]; then
  echo "Mount the repository at /workspace." >&2
  exit 1
fi

dnf install -y findutils git gzip tar unzip which xz >/dev/null

qualification_tmp="$(mktemp -d /tmp/eacl-demo-jvm-qualification.XXXXXX)"
cleanup() {
  find "${qualification_tmp}" -mindepth 1 -delete
  rmdir "${qualification_tmp}"
}
trap cleanup EXIT

node_archive="node-v24.19.0-linux-x64.tar.xz"
jdk_archive="OpenJDK25U-jdk_x64_linux_hotspot_25.0.4.1_1.tar.gz"
clojure_archive="clojure-tools-1.12.5.1664.tar.gz"

curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
  "https://nodejs.org/dist/v24.19.0/${node_archive}" \
  --output "${qualification_tmp}/${node_archive}"
curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
  "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/${jdk_archive}" \
  --output "${qualification_tmp}/${jdk_archive}"
curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
  "https://download.clojure.org/install/${clojure_archive}" \
  --output "${qualification_tmp}/${clojure_archive}"

(
  cd "${qualification_tmp}"
  sha256sum --check <<'CHECKSUMS'
14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647  node-v24.19.0-linux-x64.tar.xz
dbb698396d478e7fa2b1e50f4103324b2a99b90569ee27c33f2261f9215cf41e  OpenJDK25U-jdk_x64_linux_hotspot_25.0.4.1_1.tar.gz
77dd6868948074adcc93e83a796f8e8f15a1a92bcb1b9002d715fd2210e476f3  clojure-tools-1.12.5.1664.tar.gz
CHECKSUMS
)

mkdir -p /opt/eacl-node /opt/eacl-jdk /opt/eacl-clojure
tar -xJf "${qualification_tmp}/${node_archive}" \
  --strip-components=1 -C /opt/eacl-node
tar -xzf "${qualification_tmp}/${jdk_archive}" \
  --strip-components=1 -C /opt/eacl-jdk
tar -xzf "${qualification_tmp}/${clojure_archive}" \
  -C /opt/eacl-clojure

mkdir -p /usr/local/bin /usr/local/lib/clojure/libexec
install -m 644 /opt/eacl-clojure/clojure-tools/deps.edn \
  /usr/local/lib/clojure/deps.edn
install -m 644 /opt/eacl-clojure/clojure-tools/example-deps.edn \
  /usr/local/lib/clojure/example-deps.edn
install -m 644 /opt/eacl-clojure/clojure-tools/tools.edn \
  /usr/local/lib/clojure/tools.edn
install -m 644 /opt/eacl-clojure/clojure-tools/exec.jar \
  /usr/local/lib/clojure/libexec/exec.jar
install -m 644 \
  /opt/eacl-clojure/clojure-tools/clojure-tools-1.12.5.1664.jar \
  /usr/local/lib/clojure/libexec/clojure-tools-1.12.5.1664.jar
install -m 755 /opt/eacl-clojure/clojure-tools/clojure \
  /usr/local/bin/clojure
install -m 755 /opt/eacl-clojure/clojure-tools/clj \
  /usr/local/bin/clj
sed -i 's@PREFIX@/usr/local/lib/clojure@g' /usr/local/bin/clojure
sed -i 's@BINDIR@/usr/local/bin@g' /usr/local/bin/clj
chmod 755 /usr/local/bin/clojure /usr/local/bin/clj

export JAVA_HOME=/opt/eacl-jdk
export PATH="/opt/eacl-node/bin:/opt/eacl-jdk/bin:/usr/local/bin:/usr/bin:/bin"
git config --global --add safe.directory /workspace
git config --global --add safe.directory \
  /workspace/target/eacl-core-source/858a73a62dfcdf05a5341787f806796d55fd2aff

node --version
npm --version
java -version
clojure -Sdescribe

cd /workspace
node scripts/verify-datahike-s3-artifact-determinism.mjs
node scripts/audit-datahike-s3-lambda-artifact.mjs
node scripts/verify-datahike-dynamodb-artifact-determinism.mjs
node scripts/audit-datahike-dynamodb-lambda-artifact.mjs
node scripts/verify-datomic-artifact-determinism.mjs
node scripts/audit-datomic-lambda-artifact.mjs
node scripts/audit-datomic-seed-artifact.mjs

sha256sum \
  dist/datahike-s3/function.jar \
  dist/datahike-dynamodb/function.jar \
  dist/datomic-dynamodb/function.jar \
  dist/datomic-dynamodb-seed/seed.jar
stat --format='%n %s bytes' \
  dist/datahike-s3/function.jar \
  dist/datahike-dynamodb/function.jar \
  dist/datomic-dynamodb/function.jar \
  dist/datomic-dynamodb-seed/seed.jar
