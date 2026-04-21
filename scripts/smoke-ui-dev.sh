#!/bin/sh

set -eu

wait_for_response() {
  url="$1"
  attempts="${2:-90}"
  delay="${3:-1}"

  while [ "$attempts" -gt 0 ]; do
    if response="$(curl -fsS "$url" 2>/dev/null)"; then
      printf '%s' "$response"
      return 0
    fi

    attempts=$((attempts - 1))
    sleep "$delay"
  done

  echo "Timed out waiting for $url" >&2
  return 1
}

echo "Checking simulator_ui dev entrypoint..."
html="$(wait_for_response http://simulator_ui/)"
printf '%s' "$html" | grep -q "/@vite/client"

echo "Checking simulator_ui dev proxy to core_trading..."
wait_for_response http://simulator_ui/core/health | jq -e '.status == "ok"' >/dev/null

echo "Checking simulator_ui dev proxy to data_pipeline..."
wait_for_response http://simulator_ui/data/health | jq -e '.status == "ok"' >/dev/null

echo "simulator_ui dev smoke passed."
