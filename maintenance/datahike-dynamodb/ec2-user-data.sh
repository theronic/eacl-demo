#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export EACL_ARTIFACT_BUCKET=eacl-demo-foundation-artifactbucket-xxzglw0b0v6t
export EACL_SEED_ARTIFACT_SHA256=db64a64f345b3f4d25a7b035dd54c3cef4042ae9e358d0b5cd96bd5b0a166156
export EACL_FIXTURE_STREAM_SHA256=619b569cabb238b473eea92078bdec5689c8ee7d9a4bc129fb257df01dd47898
export EACL_FIXTURE_MANIFEST_DIGEST=sha256:718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0
export EACL_FIXTURE_STREAM_KEY=artifacts/datahike-dynamodb/fixtures/619b569cabb238b473eea92078bdec5689c8ee7d9a4bc129fb257df01dd47898/fixture-1000000.batches.jsonl.gz
export EACL_FIXTURE_STREAM_VERSION=ibr4DBUiUTsZYJ.Sh0o64b3YTYZvpvn9
export EACL_DATAHIKE_TABLE=eacl-demo-datahike-fixture-v1-green
export EACL_DATAHIKE_STORE_ID=2d692f8e-0778-49bf-aed7-241e93d63b2f
export EACL_STORE_ARCHIVE_KEY=artifacts/datahike-dynamodb/stores/fixture-v1-green/store.tar.gz
export EACL_EXPORT_CHECKPOINT_KEY=checkpoints/datahike-dynamodb/fixture-v1-green/export.json
export EACL_SEED_EVIDENCE_KEY=evidence/datahike-dynamodb/fixture-v1-green/seed-evidence.jsonl

seed_key=artifacts/datahike-dynamodb/seed/db64a64f345b3f4d25a7b035dd54c3cef4042ae9e358d0b5cd96bd5b0a166156/seed.jar
seed_version=OSdOrn8UclkH_i1q5nWdjADiuQr1MN_b
jdk_key=artifacts/datahike-dynamodb/jdk/b838e42c8e915019ed34e4cc54c7cda2e7e00d2a2a49be44578814735fc9accc/amazon-corretto-25-x64-linux-jdk.tar.gz
jdk_version=710yjHqwdY8de3IVwMEUkx6SIXBUvQ2V
jdk_sha256=b838e42c8e915019ed34e4cc54c7cda2e7e00d2a2a49be44578814735fc9accc
jdk_root=amazon-corretto-25.0.4.8.1-linux-x64
log_file=/var/log/eacl-demo-datahike-seed.log

exec > >(tee -a "$log_file") 2>&1

cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    aws s3api put-object \
      --bucket "$EACL_ARTIFACT_BUCKET" \
      --key "$EACL_SEED_EVIDENCE_KEY" \
      --body "$log_file" \
      --server-side-encryption AES256 || true
  fi
  systemctl poweroff || true
  exit "$status"
}
trap cleanup EXIT

# The API launch sets instance-initiated shutdown to terminate. This timer is
# the independent cost ceiling if cloud-init, Java, or the exporter hangs.
systemd-run --unit=eacl-datahike-seed-deadline --on-active=330m \
  /usr/bin/systemctl poweroff

work_dir=/var/lib/eacl-demo-datahike-seed
install -d -m 0700 "$work_dir"
cd "$work_dir"

aws s3api get-object --bucket "$EACL_ARTIFACT_BUCKET" --key "$seed_key" \
  --version-id "$seed_version" seed.jar >/dev/null
printf '%s  %s\n' "$EACL_SEED_ARTIFACT_SHA256" seed.jar | sha256sum --check --strict
aws s3api get-object --bucket "$EACL_ARTIFACT_BUCKET" --key "$jdk_key" \
  --version-id "$jdk_version" corretto.tar.gz >/dev/null
printf '%s  %s\n' "$jdk_sha256" corretto.tar.gz | sha256sum --check --strict
tar --extract --gzip --file corretto.tar.gz
[[ -x "$work_dir/$jdk_root/bin/java" && -x "$work_dir/$jdk_root/bin/jar" ]]
export JAVA_HOME="$work_dir/$jdk_root"
export PATH="$JAVA_HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

jar --extract --file seed.jar seed-runner.sh
chmod 0700 seed-runner.sh
./seed-runner.sh
