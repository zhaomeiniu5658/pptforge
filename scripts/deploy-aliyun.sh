#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env. Copy deploy/aliyun.env.example to .env and fill it first." >&2
  exit 1
fi

chmod 600 .env
compose=(docker compose -f compose.yaml -f compose.aliyun.yaml --profile full)

"${compose[@]}" config --quiet
"${compose[@]}" up -d --build

echo "Waiting for the public web container..."
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_BIND_PORT:-80}/" >/dev/null 2>&1; then
    echo "Quarkmed is serving HTTP on port ${WEB_BIND_PORT:-80}."
    "${compose[@]}" ps
    exit 0
  fi
  sleep 2
done

echo "The stack did not become ready. Recent service status:" >&2
"${compose[@]}" ps >&2
"${compose[@]}" logs --tail=100 api web tools worker >&2 || true
exit 1

