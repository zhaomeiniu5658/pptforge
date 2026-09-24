#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${QUARKMED_ENV_LOADED:-}" != "1" ]; then
 exec .venv/bin/python scripts/with-env.py bash "$0" "$@"
fi
export PYTHONPATH="$PWD/services/api"
export SOFFICE_PATH="${SOFFICE_PATH:-$(command -v soffice || true)}"
mkdir -p artifacts
.venv/bin/alembic -c migrations/alembic.ini upgrade head
pids=()
cleanup(){ for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
node services/render-tools/src/server.js > artifacts/tools.log 2>&1 & pids+=("$!")
.venv/bin/uvicorn quark.main:app --host 127.0.0.1 --port 8011 > artifacts/api.log 2>&1 & pids+=("$!")
.venv/bin/celery -A quark.tasks:celery worker --loglevel=info --pool=solo > artifacts/worker.log 2>&1 & pids+=("$!")
npm run dev > artifacts/web.log 2>&1 & pids+=("$!")
echo 'Quarkmed: http://localhost:5174 (logs in artifacts/)'
wait
