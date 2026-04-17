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

curl -fsS \
  -X POST \
  http://core_trading:8080/api/paper/session/start \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"restore-session"}' >/dev/null

curl -fsS \
  -X POST \
  http://data_pipeline:8000/api/data/strategy/signals/publish \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"baseline","strategy_id":"baseline-trend","limit":1,"offset":0}' >/dev/null

curl -fsS \
  -X POST \
  http://data_pipeline:8000/api/data/market/quotes/publish \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"baseline","transport":"http"}' >/dev/null

session_before=$(curl -fsS http://core_trading:8080/api/paper/session)
printf '%s' "$session_before" | jq -e '.session.id == "restore-session"' >/dev/null
