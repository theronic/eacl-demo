#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  infra)
    python3 - <<'PY'
import os, pathlib, secrets, subprocess
base = pathlib.Path('target/local-dev').resolve()
base.mkdir(parents=True, exist_ok=True)
(base / 'datomic').mkdir(exist_ok=True)
env_file = base / 'local.env'
if not env_file.exists():
    env_file.write_text('EACL_LOCAL_S3_ACCESS_KEY=eacl-local\nEACL_LOCAL_S3_SECRET_KEY=' + secrets.token_hex(24) + '\n')
    env_file.chmod(0o600)
env = dict(line.split('=', 1) for line in env_file.read_text().splitlines())
minio_env = base / 'minio.env'
minio_env.write_text('MINIO_ROOT_USER=' + env['EACL_LOCAL_S3_ACCESS_KEY'] + '\nMINIO_ROOT_PASSWORD=' + env['EACL_LOCAL_S3_SECRET_KEY'] + '\n')
minio_env.chmod(0o600)
name = 'eacl-v8-playground-minio'
existing = subprocess.run(['docker', 'container', 'inspect', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if existing.returncode == 0:
    subprocess.run(['docker', 'start', name], check=True)
else:
    subprocess.run(['docker', 'run', '--detach', '--name', name,
                    '--publish', '127.0.0.1:19400:9000', '--publish', '127.0.0.1:19401:9001',
                    '--volume', name + ':/data', '--env-file', str(minio_env),
                    'minio/minio:RELEASE.2025-09-07T16-13-09Z',
                    'server', '/data', '--console-address', ':9001'], check=True)
(base / 'transactor.properties').write_text(
    'protocol=dev\nhost=localhost\nport=14334\nh2-port=14335\nstorage-access=local\n'
    'memory-index-threshold=32m\nmemory-index-max=256m\nobject-cache-max=128m\n'
    f'data-dir={base / "datomic"}\nlog-dir={base / "datomic"}\n')
PY
    exec "${EACL_LOCAL_DATOMIC_HOME:-$HOME/datomic/1.0.7705}/bin/transactor" \
      -Xms256m -Xmx1g "$PWD/target/local-dev/transactor.properties"
    ;;
  api)
    set -a
    source target/local-dev/local.env
    set +a
    exec clojure -M:local-dev -m eacl-demo.local
    ;;
  ui)
    exec npx vite --config apps/explorer-main/vite.config.ts --strictPort
    ;;
  *) echo "usage: bash scripts/local-dev.sh {infra|api|ui}" >&2; exit 2 ;;
esac
