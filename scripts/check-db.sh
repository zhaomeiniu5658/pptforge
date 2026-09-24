#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${QUARKMED_ENV_LOADED:-}" != "1" ]; then
 exec .venv/bin/python scripts/with-env.py bash "$0" "$@"
fi
export PYTHONPATH="$PWD/services/api"
.venv/bin/python scripts/check-db.py
