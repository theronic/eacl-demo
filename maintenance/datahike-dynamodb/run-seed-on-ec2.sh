#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

required=(
  AWS_REGION EACL_ARTIFACT_BUCKET EACL_SEED_ARTIFACT_SHA256
  EACL_FIXTURE_STREAM_KEY EACL_FIXTURE_STREAM_VERSION
  EACL_FIXTURE_STREAM_SHA256 EACL_FIXTURE_MANIFEST_DIGEST
  EACL_DATAHIKE_TABLE EACL_DATAHIKE_STORE_ID EACL_STORE_ARCHIVE_KEY
  EACL_EXPORT_CHECKPOINT_KEY EACL_SEED_EVIDENCE_KEY
)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { printf 'missing required environment: %s\n' "$name" >&2; exit 64; }
done

[[ "$AWS_REGION" == us-east-1 ]]
[[ "$EACL_ARTIFACT_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]
[[ "$EACL_SEED_ARTIFACT_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$EACL_FIXTURE_STREAM_KEY" =~ ^artifacts/datahike-dynamodb/fixtures/([a-f0-9]{64})/fixture-1000000\.batches\.jsonl\.gz$ ]]
[[ "${BASH_REMATCH[1]}" == "$EACL_FIXTURE_STREAM_SHA256" ]]
[[ "$EACL_FIXTURE_STREAM_VERSION" =~ ^[A-Za-z0-9._-]{1,1024}$ ]]
[[ "$EACL_FIXTURE_MANIFEST_DIGEST" == sha256:718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0 ]]
[[ "$EACL_DATAHIKE_TABLE" == eacl-demo-datahike-fixture-v1-green ]]
[[ "$EACL_DATAHIKE_STORE_ID" == 2d692f8e-0778-49bf-aed7-241e93d63b2f ]]
[[ "$EACL_STORE_ARCHIVE_KEY" == artifacts/datahike-dynamodb/stores/fixture-v1-green/store.tar.gz ]]
[[ "$EACL_EXPORT_CHECKPOINT_KEY" == checkpoints/datahike-dynamodb/fixture-v1-green/export.json ]]
[[ "$EACL_SEED_EVIDENCE_KEY" =~ ^evidence/datahike-dynamodb/[a-z0-9-]{3,80}/seed-evidence\.jsonl$ ]]

work_dir=/var/lib/eacl-demo-datahike-seed
install -d -m 0700 "$work_dir"
cd "$work_dir"
exec 9>seed.lock
flock --exclusive --nonblock 9 || { printf 'another seed process holds the local lock\n' >&2; exit 1; }

java -version
aws --version
printf '%s  %s\n' "$EACL_SEED_ARTIFACT_SHA256" seed.jar | sha256sum --check --strict

aws s3api get-object \
  --bucket "$EACL_ARTIFACT_BUCKET" \
  --key "$EACL_FIXTURE_STREAM_KEY" \
  --version-id "$EACL_FIXTURE_STREAM_VERSION" \
  fixture.batches.jsonl.gz >/dev/null
printf '%s  %s\n' "$EACL_FIXTURE_STREAM_SHA256" fixture.batches.jsonl.gz | sha256sum --check --strict
gzip --test fixture.batches.jsonl.gz

archive_present=false
if archive_head="$(aws s3api head-object --bucket "$EACL_ARTIFACT_BUCKET" \
     --key "$EACL_STORE_ARCHIVE_KEY" 2>archive-head.stderr)"; then
  archive_present=true
elif ! grep --extended-regexp --quiet '(404|Not Found|NoSuchKey)' archive-head.stderr; then
  cat archive-head.stderr >&2
  exit 1
fi

if [[ "$archive_present" == true ]]; then
  read -r archive_version archive_sha256 archive_store_id archive_manifest_digest < <(
    python3 - "$archive_head" <<'PY'
import json
import sys

value = json.loads(sys.argv[1])
metadata = value.get("Metadata") or {}
fields = [
    value.get("VersionId"),
    metadata.get("archive-sha256"),
    metadata.get("store-id"),
    metadata.get("manifest-digest"),
]
if not all(isinstance(field, str) and field for field in fields):
    raise SystemExit("archive identity metadata is incomplete")
print(*fields)
PY
  )
  [[ "$archive_sha256" =~ ^[a-f0-9]{64}$ ]]
  [[ "$archive_store_id" == "$EACL_DATAHIKE_STORE_ID" ]]
  [[ "$archive_manifest_digest" == "$EACL_FIXTURE_MANIFEST_DIGEST" ]]
  aws s3api get-object \
    --bucket "$EACL_ARTIFACT_BUCKET" \
    --key "$EACL_STORE_ARCHIVE_KEY" \
    --version-id "$archive_version" store.tar.gz >/dev/null
  printf '%s  %s\n' "$archive_sha256" store.tar.gz | sha256sum --check --strict
  python3 - store.tar.gz <<'PY'
import pathlib
import re
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
pattern = re.compile(r"store/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.ksv")
with tarfile.open(archive, "r:gz") as source:
    members = source.getmembers()
    files = [member for member in members if member.isfile()]
    if not files or len(files) > 250_000:
        raise SystemExit("archive object count is outside the bound")
    for member in members:
        if member.isdir() and member.name == "store":
            continue
        if not member.isfile() or not pattern.fullmatch(member.name):
            raise SystemExit("archive contains a foreign or unsafe member")
        if member.size < 20 or member.size > 380 * 1024:
            raise SystemExit("archive member size is outside the bound")
    source.extractall(path=".")
PY
  printf '{"kind":"archive-recovered","archiveVersion":"%s","archiveSha256":"sha256:%s"}\n' \
    "$archive_version" "$archive_sha256" > seed-evidence.jsonl
else
  export EACL_DATAHIKE_STORE_PATH="$work_dir/store"
  export EACL_FIXTURE_CUT_POINT=1000000
  timeout --foreground 7200 bash -o pipefail -c \
    'gzip --decompress --stdout fixture.batches.jsonl.gz | java -server -Xms4g -Xmx20g -cp seed.jar clojure.main -m eacl-demo.datahike-dynamodb.build-main' \
    >> seed-evidence.jsonl
  python3 - seed-evidence.jsonl <<'PY'
import json
import os
import pathlib

lines = [line for line in pathlib.Path("seed-evidence.jsonl").read_text(encoding="utf-8").splitlines() if line]
final = json.loads(lines[-1]) if lines else {}
if (
    final.get("kind") != "build-complete"
    or final.get("status") != "ready"
    or final.get("manifestDigest") != os.environ["EACL_FIXTURE_MANIFEST_DIGEST"]
    or final.get("storeId") != os.environ["EACL_DATAHIKE_STORE_ID"]
    or (final.get("counts") or {}).get("resources") != 1_000_000
):
    raise SystemExit("local Datahike build evidence is invalid")
PY
  find store -maxdepth 1 -type f ! -name '*.ksv' ! -name '*.ksv.cas' -print -quit | grep --quiet . && {
    printf 'store contains a foreign file\n' >&2
    exit 1
  }
  tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 \
    --numeric-owner --exclude='*.ksv.cas' --create store | gzip --no-name > store.tar.gz
  archive_sha256="$(sha256sum store.tar.gz | cut -d' ' -f1)"
  archive_version="$(aws s3api put-object \
    --bucket "$EACL_ARTIFACT_BUCKET" \
    --key "$EACL_STORE_ARCHIVE_KEY" \
    --body store.tar.gz \
    --server-side-encryption AES256 \
    --metadata "archive-sha256=$archive_sha256,store-id=$EACL_DATAHIKE_STORE_ID,manifest-digest=$EACL_FIXTURE_MANIFEST_DIGEST" \
    --query VersionId --output text)"
  [[ -n "$archive_version" && "$archive_version" != None ]]
  printf '{"kind":"archive-created","archiveVersion":"%s","archiveSha256":"sha256:%s"}\n' \
    "$archive_version" "$archive_sha256" >> seed-evidence.jsonl
fi

export EACL_DATAHIKE_STORE_PATH="$work_dir/store"
export EACL_FIXTURE_CUT_POINT=1000000
export EACL_STORE_ARCHIVE_SHA256="sha256:$archive_sha256"
timeout --foreground 10800 java -server -Xms2g -Xmx12g -cp seed.jar clojure.main \
  -m eacl-demo.datahike-dynamodb.export-main >> seed-evidence.jsonl
timeout --foreground 1800 java -server -Xms2g -Xmx20g -cp seed.jar clojure.main \
  -m eacl-demo.datahike-dynamodb.verify-main >> seed-evidence.jsonl

python3 - seed-evidence.jsonl <<'PY'
import json
import os
import pathlib

lines = [json.loads(line) for line in pathlib.Path("seed-evidence.jsonl").read_text(encoding="utf-8").splitlines() if line]
exported = next((line for line in reversed(lines) if line.get("kind") == "export-complete"), None)
verified = next((line for line in reversed(lines) if line.get("kind") == "verify-complete"), None)
if (
    not exported
    or exported.get("status") != "exported"
    or exported.get("manifestDigest") != os.environ["EACL_FIXTURE_MANIFEST_DIGEST"]
    or not verified
    or verified.get("status") != "ready"
    or (verified.get("counts") or {}).get("resources") != 1_000_000
):
    raise SystemExit("Datahike DynamoDB export verification is invalid")
PY

evidence_version="$(aws s3api put-object \
  --bucket "$EACL_ARTIFACT_BUCKET" \
  --key "$EACL_SEED_EVIDENCE_KEY" \
  --body seed-evidence.jsonl \
  --server-side-encryption AES256 \
  --query VersionId --output text)"
[[ -n "$evidence_version" && "$evidence_version" != None ]]
evidence_sha256="$(sha256sum seed-evidence.jsonl | cut -d' ' -f1)"
printf '{"kind":"seed-run-complete","evidenceKey":"%s","evidenceVersion":"%s","evidenceSha256":"%s","archiveVersion":"%s","archiveSha256":"%s"}\n' \
  "$EACL_SEED_EVIDENCE_KEY" "$evidence_version" "$evidence_sha256" \
  "$archive_version" "$archive_sha256"
