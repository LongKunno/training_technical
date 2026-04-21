#!/bin/sh

set -eu

wait_for_json() {
  url="$1"
  attempts="${2:-60}"
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

echo "Checking simulator_ui runtime health endpoint..."
runtime_health="$(wait_for_json http://simulator_ui/health)"
printf '%s' "$runtime_health" | jq -e '.status == "ok" and .service == "simulator_ui" and .mode == "production"' >/dev/null

echo "Checking simulator_ui runtime proxy to core_trading..."
wait_for_json http://simulator_ui/core/health | jq -e '.status == "ok"' >/dev/null

echo "Checking simulator_ui runtime proxy to data_pipeline..."
wait_for_json http://simulator_ui/data/health | jq -e '.status == "ok"' >/dev/null

echo "simulator_ui runtime smoke passed."
