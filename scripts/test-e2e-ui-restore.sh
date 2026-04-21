#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

compose() {
  docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.ui-e2e.yml" "$@"
}

compose_ops() {
  COMPOSE_PROFILES=ops docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.ui-e2e.yml" "$@"
}

cleanup() {
  status="$?"

  if [ "$status" -ne 0 ]; then
    echo "UI restore E2E failed. Showing recent service logs before teardown..." >&2
    compose logs --tail=120 simulator_ui core_trading data_pipeline smoke_runner ui_e2e_runner || true
  fi

  echo "Cleaning up UI restore E2E stack..."
  compose down --remove-orphans || true

  exit "$status"
}

trap cleanup EXIT INT TERM

echo "Resetting any stale UI restore E2E stack..."
compose down --remove-orphans >/dev/null 2>&1 || true

echo "Starting UI restore E2E stack..."
compose up -d --build postgres redis kafka migrations core_trading data_pipeline simulator_ui

echo "Preparing restore session state..."
compose_ops run --rm --no-deps --entrypoint "sh /scripts/smoke-session-restore-prepare.sh" smoke_runner

echo "Restarting core_trading for restore verification..."
compose restart core_trading

echo "Verifying restored backend state..."
compose_ops run --rm --no-deps --entrypoint "sh /scripts/smoke-session-restore-verify.sh" smoke_runner

echo "Running Playwright restore acceptance..."
compose run --build --rm --no-deps ui_e2e_runner sh -lc 'npm run test:e2e:restore'
