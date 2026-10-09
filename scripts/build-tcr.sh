#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Authenticate separately with docker login; never pass credentials as build args.
: "${TCR_NAMESPACE:?Set TCR_NAMESPACE to an existing Tencent Cloud registry namespace}"
TCR_REGISTRY="${TCR_REGISTRY:-ccr.ccs.tencentyun.com}"
IMAGE_VERSION="${IMAGE_VERSION:-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)}"
BUILD_ACTION="${BUILD_ACTION:-push}"
case "$BUILD_ACTION" in push|load) ;; *) echo 'BUILD_ACTION must be push or load' >&2; exit 2;; esac

for component in web api tools; do
  args=()
  case "$component" in
    api) [ -z "${PYTHON_IMAGE:-}" ] || args+=(--build-arg "PYTHON_IMAGE=$PYTHON_IMAGE") ;;
    web|tools) [ -z "${NODE_IMAGE:-}" ] || args+=(--build-arg "NODE_IMAGE=$NODE_IMAGE") ;;
  esac
  if [ "$component" = web ] && [ -n "${NGINX_IMAGE:-}" ]; then
    args+=(--build-arg "NGINX_IMAGE=$NGINX_IMAGE")
  fi
  docker buildx build --platform linux/amd64 \
    -f "deploy/$component.Dockerfile" \
    -t "$TCR_REGISTRY/$TCR_NAMESPACE/ppt-creation-$component:$IMAGE_VERSION" \
    "${args[@]}" "--$BUILD_ACTION" .
done
