#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${QUARKMED_ENV_LOADED:-}" != "1" ]; then
 exec .venv/bin/python scripts/with-env.py bash "$0" "$@"
fi
export PYTHONPATH="$PWD/services/api"
if [ "${QUARKMED_RUN_INTEGRATION:-}" != "1" ]; then
 echo 'Integration tests create QA projects. Run only against a test deployment with QUARKMED_RUN_INTEGRATION=1.' >&2
 exit 1
fi
npm test
.venv/bin/pytest tests -q
