#!/usr/bin/env bash
# Deploy the API + run migrations on the VM. Idempotent.
#
# Expects the working directory to be infra/ on the VM, and the four env files
# to exist: .env, .env.api, .env.postgres. The image tag to deploy is taken
# from the API_IMAGE value in .env (which the CI workflow rewrites on each
# successful build).
#
# Usage:
#   ./deploy.sh           # pull + migrate + restart api
#   ./deploy.sh --no-pull # skip image pull (use whatever's local)

set -euo pipefail

cd "$(dirname "$0")"

PULL=true
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=false ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f .env ]] || [[ ! -f .env.api ]] || [[ ! -f .env.postgres ]]; then
  echo "missing one of .env / .env.api / .env.postgres in $(pwd)" >&2
  exit 1
fi

echo "==> ensuring postgres is up"
docker compose --env-file .env up -d postgres

echo "==> waiting for postgres healthcheck"
for _ in $(seq 1 60); do
  if docker compose --env-file .env exec -T postgres pg_isready -q; then break; fi
  sleep 1
done

if [[ "$PULL" == "true" ]]; then
  echo "==> pulling latest images"
  docker compose --env-file .env pull api migrate
fi

echo "==> running migrations (one-shot)"
docker compose --env-file .env run --rm migrate

echo "==> rolling api"
docker compose --env-file .env up -d api caddy

echo "==> deployed. compose ps:"
docker compose --env-file .env ps
