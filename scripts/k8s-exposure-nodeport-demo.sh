#!/bin/sh

set -eu

SIMULATOR_NODEPORT_HOST_PORT="${SIMULATOR_NODEPORT_HOST_PORT:-18021}"
BASE_URL="http://127.0.0.1:${SIMULATOR_NODEPORT_HOST_PORT}"

wait_for_url() {
  url="$1"
  attempts=0

  until curl -fsS "${url}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "${attempts}" -ge 60 ]; then
      echo "Timed out waiting for ${url}" >&2
      return 1
    fi
    sleep 2
  done
}

wait_for_url "${BASE_URL}/health"
wait_for_url "${BASE_URL}/core/health"
wait_for_url "${BASE_URL}/data/health"

ui_page="$(curl -fsS "${BASE_URL}/")"
printf '%s' "${ui_page}" | grep -q "Simulator Operator Platform"
