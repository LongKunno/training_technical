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

assert_request_id_header() {
  url="$1"
  request_id="$(curl -fsS -D - -o /dev/null "$url" | awk 'tolower($1) == "x-request-id:" {print $2}' | tr -d '\r')"
  test -n "$request_id"
}

echo "Checking simulator_ui runtime health endpoint..."
runtime_health="$(wait_for_json http://simulator_ui/health)"
printf '%s' "$runtime_health" | jq -e '.status == "ok" and .service == "simulator_ui" and .mode == "production"' >/dev/null
printf '%s' "$runtime_health" | jq -e '.request_id | type == "string" and length > 0' >/dev/null
assert_request_id_header http://simulator_ui/health

echo "Checking simulator_ui runtime proxy to core_trading..."
wait_for_json http://simulator_ui/core/health | jq -e '.status == "ok"' >/dev/null
assert_request_id_header http://simulator_ui/core/health

echo "Checking simulator_ui runtime proxy to data_pipeline..."
wait_for_json http://simulator_ui/data/health | jq -e '.status == "ok"' >/dev/null
assert_request_id_header http://simulator_ui/data/health

echo "Checking simulator_ui runtime bot runner health surface..."
wait_for_json http://simulator_ui/bot/health | jq -e '.status == "ok"' >/dev/null
assert_request_id_header http://simulator_ui/bot/health

echo "Checking simulator_ui runtime does not expose bot runner internals..."
bot_internal_status=$(curl -s -o /dev/null -w '%{http_code}' http://simulator_ui/bot/internal/runs/start)
test "$bot_internal_status" = "404"

echo "Checking simulator_ui runtime does not expose core ops internals..."
core_ops_status=$(curl -s -o /dev/null -w '%{http_code}' http://simulator_ui/core/internal/ops/benchmark/cpu)
test "$core_ops_status" = "404"

echo "Checking simulator_ui runtime does not expose data ops internals..."
data_ops_status=$(curl -s -o /dev/null -w '%{http_code}' http://simulator_ui/data/internal/ops/benchmark/cpu)
test "$data_ops_status" = "404"

echo "simulator_ui runtime smoke passed."
