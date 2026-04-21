#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

compose() {
  docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.ui-e2e.yml" "$@"
}

cleanup() {
  status="$?"

  if [ "$status" -ne 0 ]; then
    echo "Live UI E2E failed. Showing recent service logs before teardown..." >&2
    compose logs --tail=120 simulator_ui core_trading data_pipeline ui_e2e_runner || true
  fi

  echo "Cleaning up live UI E2E stack..."
  compose down --remove-orphans || true

  exit "$status"
}

trap cleanup EXIT INT TERM

echo "Resetting any stale live UI E2E stack..."
compose down --remove-orphans >/dev/null 2>&1 || true

echo "Starting live UI E2E stack..."
compose up -d --build postgres redis kafka migrations core_trading data_pipeline simulator_ui

echo "Running Playwright live acceptance..."
compose run --build --rm --no-deps ui_e2e_runner sh -lc 'npm run test:e2e:live'
