#!/usr/bin/env bash
set -euo pipefail
cat >&2 <<'MESSAGE'
Automatic restoration is disabled for the remote database.
See docs/implementation/operations.md. Ask the DBA to restore only the platform schema
into a prepared target database, then restore the matching asset archive.
MESSAGE
exit 1
