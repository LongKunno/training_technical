#!/bin/sh

set -eu

wait_for_url() {
  url="$1"
  attempts=0

  until curl -fsS "$url" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 40 ]; then
      echo "Timed out waiting for $url" >&2
      return 1
    fi
    sleep 1
  done
}

wait_for_url http://core_trading:8080/health
wait_for_url http://data_pipeline:8000/health
wait_for_url http://bot_runner:8001/health
wait_for_url http://simulator_ui/

bots_response=$(curl -fsS http://core_trading:8080/api/sim/bots)
printf '%s' "$bots_response" | jq -e '.bots | map(.bot_id) | index("baseline-roundtrip") != null' >/dev/null

run_response=$(
  curl -fsS \
    -X POST \
    http://core_trading:8080/api/sim/runs \
    -H 'Content-Type: application/json' \
    -d '{"bot_id":"baseline-roundtrip","scenario_id":"baseline"}'
)

run_id=$(printf '%s' "$run_response" | jq -r '.run.run_id')
session_id=$(printf '%s' "$run_response" | jq -r '.run.session_id')

printf '%s' "$run_response" | jq -e '.run.status == "running"' >/dev/null
printf '%s' "$run_response" | jq -e '.run.bot_id == "baseline-roundtrip"' >/dev/null

attempt=0
latest_run_payload=""
until [ "$attempt" -ge 20 ]; do
  latest_run_payload=$(curl -fsS "http://core_trading:8080/api/sim/runs/${run_id}")
  if printf '%s' "$latest_run_payload" | jq -e '.run.status == "completed"' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

printf '%s' "$latest_run_payload" | jq -e '.run.status == "completed"' >/dev/null
printf '%s' "$latest_run_payload" | jq -e --arg session_id "$session_id" '.run.session_id == $session_id' >/dev/null

runs_response=$(curl -fsS "http://core_trading:8080/api/sim/runs?limit=10&offset=0")
printf '%s' "$runs_response" | jq -e --arg run_id "$run_id" '.runs | map(.run_id) | index($run_id) != null' >/dev/null

report_response=$(curl -fsS "http://core_trading:8080/api/paper/report?session_id=${session_id}")
printf '%s' "$report_response" | jq -e '.report.filled_orders >= 4' >/dev/null

audit_response=$(curl -fsS "http://core_trading:8080/api/paper/audit?session_id=${session_id}&limit=50&offset=0")
printf '%s' "$audit_response" | jq -e '.events | length >= 8' >/dev/null

timeline_response=$(curl -fsS "http://core_trading:8080/api/paper/timeline?session_id=${session_id}")
printf '%s' "$timeline_response" | jq -e '.timeline | length >= 5' >/dev/null
