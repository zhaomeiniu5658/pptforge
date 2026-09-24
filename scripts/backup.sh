#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${QUARKMED_ENV_LOADED:-}" != "1" ]; then
 exec .venv/bin/python scripts/with-env.py bash "$0" "$@"
fi
export PYTHONPATH="$PWD/services/api"
backup_dir="${1:-backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$backup_dir"
.venv/bin/python scripts/backup-db.py "$backup_dir/database.dump"
if docker compose --profile full ps --status running --services | grep -qx api; then
 docker compose exec -T api tar -C /data -czf - assets > "$backup_dir/assets.tar.gz"
else
 tar -C data -czf "$backup_dir/assets.tar.gz" assets
fi
echo "Backup saved: $backup_dir"
