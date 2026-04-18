#!/bin/sh

set -eu

wait_for_url() {
  url="$1"
  attempts=0

  until curl -fsS "$url" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "Timed out waiting for $url" >&2
      return 1
    fi
    sleep 1
  done
}

wait_for_url http://core_trading:8080/health
wait_for_url http://data_pipeline:8000/health
wait_for_url http://simulator_ui/

ui_page=$(curl -fsS http://simulator_ui/)
printf '%s' "$ui_page" | grep -q "Simulator Operator Platform"

session_response=$(
  curl -fsS \
    -X POST \
    http://core_trading:8080/api/paper/session/start \
    -H 'Content-Type: application/json' \
    -d '{"session_id":"smoke-session-a"}'
)

printf '%s' "$session_response" | jq -e '.session.status == "running"' >/dev/null

buy_response=$(
  curl -fsS \
    -X POST \
    http://data_pipeline:8000/api/data/strategy/signals/publish \
    -H 'Content-Type: application/json' \
    -d '{"scenario":"baseline","strategy_id":"baseline-trend","limit":1,"offset":0}'
)

printf '%s' "$buy_response" | jq -e '.published_count == 1' >/dev/null

publish_response=$(
  curl -fsS \
    -X POST \
    http://data_pipeline:8000/api/data/market/quotes/publish
)

printf '%s' "$publish_response" | jq -e '.published_count >= 1' >/dev/null

attempt=0
portfolio_response=""
until [ "$attempt" -ge 10 ]; do
  portfolio_response=$(curl -fsS http://core_trading:8080/api/paper/portfolio)
  if printf '%s' "$portfolio_response" | jq -e '.portfolio.positions[0].market_price == 65500' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

printf '%s' "$portfolio_response" | jq -e '.portfolio.positions[0].market_price == 65500' >/dev/null

sell_response=$(
  curl -fsS \
    -X POST \
    http://data_pipeline:8000/api/data/strategy/signals/publish \
    -H 'Content-Type: application/json' \
    -d '{"scenario":"baseline","strategy_id":"baseline-trend","limit":1,"offset":1}'
)

printf '%s' "$sell_response" | jq -e '.published_count == 1' >/dev/null

orders_response=$(curl -fsS http://core_trading:8080/api/paper/orders?symbol=BTCUSDT)
printf '%s' "$orders_response" | jq -e '.orders | length >= 2' >/dev/null

report_response=$(curl -fsS http://core_trading:8080/api/paper/report)
printf '%s' "$report_response" | jq -e '.report.filled_orders >= 2' >/dev/null

audit_response=$(curl -fsS http://core_trading:8080/api/paper/audit?limit=20)
printf '%s' "$audit_response" | jq -e '.events | length >= 5' >/dev/null

timeline_response=$(curl -fsS http://core_trading:8080/api/paper/timeline)
printf '%s' "$timeline_response" | jq -e '.timeline | length >= 3' >/dev/null

stop_a_response=$(
  curl -fsS \
    -X POST \
    http://core_trading:8080/api/paper/session/stop
)
printf '%s' "$stop_a_response" | jq -e '.session.status == "stopped"' >/dev/null

session_b_response=$(
  curl -fsS \
    -X POST \
    http://core_trading:8080/api/paper/session/start \
    -H 'Content-Type: application/json' \
    -d '{"session_id":"smoke-session-b"}'
)
printf '%s' "$session_b_response" | jq -e '.session.id == "smoke-session-b"' >/dev/null

sessions_response=$(curl -fsS http://core_trading:8080/api/paper/sessions?limit=10&offset=0)
printf '%s' "$sessions_response" | jq -e '.sessions[0].session_id == "smoke-session-b"' >/dev/null
printf '%s' "$sessions_response" | jq -e '.sessions | map(.session_id) | index("smoke-session-a") != null' >/dev/null

report_by_session=$(curl -fsS "http://core_trading:8080/api/paper/report?session_id=smoke-session-a")
printf '%s' "$report_by_session" | jq -e '.report.session_id == "smoke-session-a" and .report.filled_orders >= 2' >/dev/null

audit_by_session=$(curl -fsS "http://core_trading:8080/api/paper/audit?session_id=smoke-session-a&limit=20&offset=0")
printf '%s' "$audit_by_session" | jq -e '.events | length >= 5' >/dev/null

timeline_by_session=$(curl -fsS "http://core_trading:8080/api/paper/timeline?session_id=smoke-session-a")
printf '%s' "$timeline_by_session" | jq -e '.timeline | length >= 3' >/dev/null

stop_b_response=$(
  curl -fsS \
    -X POST \
    http://core_trading:8080/api/paper/session/stop
)
printf '%s' "$stop_b_response" | jq -e '.session.status == "stopped"' >/dev/null
