#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

required=(
  AWS_REGION EACL_ARTIFACT_BUCKET EACL_SEED_ARTIFACT_SHA256
  EACL_FIXTURE_MANIFEST_DIGEST
  EACL_FIXTURE_STREAM_KEY EACL_FIXTURE_STREAM_VERSION
  EACL_SEED_EVIDENCE_KEY EACL_DATOMIC_TABLE EACL_DATOMIC_DATABASE
  EACL_DATOMIC_ROLE_NAME EACL_DATOMIC_DISTRIBUTION_URL
  EACL_DATOMIC_DISTRIBUTION_SHA256 EACL_DATOMIC_DISTRIBUTION_BYTES
  EACL_DATOMIC_DISTRIBUTION_ROOT
)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { printf 'missing required environment: %s\n' "$name" >&2; exit 64; }
done

[[ "$AWS_REGION" =~ ^[a-z]{2}(-[a-z0-9]+)+-[0-9]$ ]]
[[ "$EACL_ARTIFACT_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]
[[ "$EACL_SEED_ARTIFACT_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$EACL_FIXTURE_MANIFEST_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$EACL_FIXTURE_STREAM_KEY" =~ ^artifacts/datomic-dynamodb/fixtures/([a-f0-9]{64})/fixture-1000000\.batches\.jsonl\.gz$ ]]
fixture_stream_sha256="${BASH_REMATCH[1]}"
[[ -n "$EACL_FIXTURE_STREAM_VERSION" && ${#EACL_FIXTURE_STREAM_VERSION} -le 1024 ]]
[[ "$EACL_SEED_EVIDENCE_KEY" =~ ^evidence/datomic-dynamodb/[a-z0-9-]{3,80}/seed-evidence\.jsonl$ ]]
[[ "$EACL_DATOMIC_TABLE" =~ ^eacl-demo-datomic-[a-z0-9-]{3,80}$ ]]
[[ "$EACL_DATOMIC_DATABASE" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]]
[[ "$EACL_DATOMIC_ROLE_NAME" =~ ^[A-Za-z0-9+=,.@_-]{1,64}$ ]]
[[ "$EACL_DATOMIC_DISTRIBUTION_URL" == https://datomic-pro-downloads.s3.amazonaws.com/*/datomic-pro-*.zip ]]
[[ "$EACL_DATOMIC_DISTRIBUTION_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$EACL_DATOMIC_DISTRIBUTION_BYTES" =~ ^[1-9][0-9]{7,9}$ ]]
[[ "$EACL_DATOMIC_DISTRIBUTION_ROOT" =~ ^datomic-pro-[0-9]+\.[0-9]+\.[0-9]+$ ]]

work_dir=/var/lib/eacl-demo-datomic-seed
install -d -m 0700 "$work_dir"
cd "$work_dir"
transactor_pid=
cleanup() {
  if [[ -n "$transactor_pid" ]] && kill -0 "$transactor_pid" 2>/dev/null; then
    kill -TERM "$transactor_pid" 2>/dev/null || true
    for _attempt in {1..30}; do
      kill -0 "$transactor_pid" 2>/dev/null || return 0
      sleep 1
    done
    kill -KILL "$transactor_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

java -version
aws --version
printf '%s  %s\n' "$EACL_SEED_ARTIFACT_SHA256" seed.jar | sha256sum --check --strict

aws s3api get-object \
  --bucket "$EACL_ARTIFACT_BUCKET" \
  --key "$EACL_FIXTURE_STREAM_KEY" \
  --version-id "$EACL_FIXTURE_STREAM_VERSION" \
  fixture.batches.jsonl.gz >/dev/null
printf '%s  %s\n' "$fixture_stream_sha256" fixture.batches.jsonl.gz | sha256sum --check --strict
gzip --test fixture.batches.jsonl.gz

curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "$EACL_DATOMIC_DISTRIBUTION_URL" \
  --output datomic-pro.zip
printf '%s  %s\n' "$EACL_DATOMIC_DISTRIBUTION_SHA256" datomic-pro.zip | sha256sum --check --strict
[[ "$(stat --format=%s datomic-pro.zip)" == "$EACL_DATOMIC_DISTRIBUTION_BYTES" ]]
unzip -q datomic-pro.zip
[[ -x "$EACL_DATOMIC_DISTRIBUTION_ROOT/bin/transactor" ]]

cat > transactor.properties <<EOF
protocol=ddb
host=127.0.0.1
port=4334
encrypt-channel=false
aws-dynamodb-table=$EACL_DATOMIC_TABLE
aws-dynamodb-region=$AWS_REGION
aws-transactor-role=$EACL_DATOMIC_ROLE_NAME
aws-peer-role=$EACL_DATOMIC_ROLE_NAME
memory-index-threshold=32m
memory-index-max=512m
object-cache-max=1g
write-concurrency=2
read-concurrency=4
index-parallelism=1
data-dir=$work_dir/data
log-dir=$work_dir/log
pid-file=$work_dir/transactor.pid
EOF

"$EACL_DATOMIC_DISTRIBUTION_ROOT/bin/transactor" \
  -Xms2g -Xmx8g "$work_dir/transactor.properties" \
  >transactor.stdout.log 2>transactor.stderr.log &
transactor_pid=$!
for attempt in {1..120}; do
  kill -0 "$transactor_pid"
  if (exec 3<>/dev/tcp/127.0.0.1/4334) 2>/dev/null; then
    exec 3>&-
    exec 3<&-
    break
  fi
  [[ "$attempt" -lt 120 ]]
  sleep 2
done

export EACL_FIXTURE_CUT_POINT=1000000
gzip --decompress --stdout fixture.batches.jsonl.gz |
  java -server -Xms2g -Xmx8g -cp seed.jar clojure.main \
    -m eacl-demo.datomic-dynamodb.seed-main > seed-evidence.jsonl

python3 - seed-evidence.jsonl <<'PY'
import json
import os
import pathlib
import sys

evidence_path = pathlib.Path(sys.argv[1])
lines = [line for line in evidence_path.read_text(encoding="utf-8").splitlines() if line]
if not lines:
    raise SystemExit("seed emitted no evidence")
final = json.loads(lines[-1])
history = final.get("history") or {}
if (
    final.get("kind") != "seed-complete"
    or final.get("status") != "ready"
    or final.get("manifestDigest") != os.environ["EACL_FIXTURE_MANIFEST_DIGEST"]
    or history.get("historyVerified") is not True
    or history.get("normalPeer") is not True
    or history.get("priorResourceCount", 0) <= 0
    or history.get("finalResourceCount") != 1_000_000
    or not (
        history.get("priorBasisT", 0)
        < history.get("contentBasisT", 0)
        < history.get("publicationBasisT", 0)
    )
):
    raise SystemExit("seed completion or history evidence is invalid")
PY

evidence_version="$(aws s3api put-object \
  --bucket "$EACL_ARTIFACT_BUCKET" \
  --key "$EACL_SEED_EVIDENCE_KEY" \
  --body seed-evidence.jsonl \
  --server-side-encryption AES256 \
  --query VersionId --output text)"
[[ -n "$evidence_version" && "$evidence_version" != None ]]
evidence_sha256="$(sha256sum seed-evidence.jsonl | cut -d' ' -f1)"
printf '{"kind":"seed-run-complete","evidenceKey":"%s","evidenceVersion":"%s","evidenceSha256":"%s"}\n' \
  "$EACL_SEED_EVIDENCE_KEY" "$evidence_version" "$evidence_sha256"
