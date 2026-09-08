#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
work_dir="$(realpath "$1")"
[[ "$work_dir" == */target/storage-v8/datomic-dynamodb ]]
transactor_pid=
cleanup() {
  if [[ -n "$transactor_pid" ]] && kill -0 "$transactor_pid" 2>/dev/null; then
    kill -TERM "$transactor_pid"
    for _attempt in {1..30}; do
      kill -0 "$transactor_pid" 2>/dev/null || return 0
      sleep 1
    done
    kill -KILL "$transactor_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
cat > "$work_dir/transactor.properties" <<EOF
protocol=ddb
host=127.0.0.1
port=4334
encrypt-channel=false
aws-dynamodb-table=eacl-demo-datomic-fixture-v8
aws-dynamodb-region=us-east-1
aws-transactor-role=eacl-demo-storage-v8-migration
aws-peer-role=eacl-demo-storage-v8-migration
memory-index-threshold=32m
memory-index-max=256m
object-cache-max=512m
write-concurrency=4
read-concurrency=4
index-parallelism=1
data-dir=$work_dir/data
log-dir=$work_dir/log
pid-file=$work_dir/transactor.pid
EOF
"$work_dir/datomic-pro-1.0.7705/bin/transactor" -Xms512m -Xmx3g \
  "$work_dir/transactor.properties" > "$work_dir/transactor.log" 2>&1 &
transactor_pid=$!
for attempt in {1..120}; do
  kill -0 "$transactor_pid"
  if (exec 3<>/dev/tcp/127.0.0.1/4334) 2>/dev/null; then
    exec 3>&-
    break
  fi
  [[ "$attempt" -lt 120 ]]
  sleep 2
done
python3 - "$work_dir" <<'PY'
import importlib.util
import json
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location("migration", "scripts/migrate-storage-v8.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
work = Path(sys.argv[1])
result = module.migrate("datomic-dynamodb", work, module.PLAN["profiles"]["datomic-dynamodb"])
(work / "complete.json").write_text(json.dumps(result, indent=2))
PY
