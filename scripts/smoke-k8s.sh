#!/bin/sh

set -eu

SIMULATOR_INGRESS_HOST="${SIMULATOR_INGRESS_HOST:-simulator.localtest.me}"
SIMULATOR_INGRESS_PORT="${SIMULATOR_INGRESS_PORT:-18020}"
BASE_URL="http://${SIMULATOR_INGRESS_HOST}:${SIMULATOR_INGRESS_PORT}"

curl_ingress() {
  curl --resolve "${SIMULATOR_INGRESS_HOST}:${SIMULATOR_INGRESS_PORT}:127.0.0.1" -fsS "$@"
}

wait_for_url() {
  url="$1"
  attempts=0

  until curl_ingress "$url" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      echo "Timed out waiting for $url" >&2
      return 1
    fi
    sleep 2
  done
}

wait_for_url "${BASE_URL}/health"
wait_for_url "${BASE_URL}/core/health"
wait_for_url "${BASE_URL}/data/health"
wait_for_url "${BASE_URL}/"

ui_page=$(curl_ingress "${BASE_URL}/")
printf '%s' "$ui_page" | grep -q "Simulator Operator Platform"

session_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/paper/session/start" \
    -H 'Content-Type: application/json' \
    -d '{"session_id":"smoke-session-a"}'
)

printf '%s' "$session_response" | jq -e '.session.status == "running"' >/dev/null

buy_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/data/api/data/strategy/signals/publish" \
    -H 'Content-Type: application/json' \
    -d '{"scenario":"baseline","strategy_id":"baseline-trend","limit":1,"offset":0}'
)

printf '%s' "$buy_response" | jq -e '.published_count == 1' >/dev/null

publish_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/data/api/data/market/quotes/publish"
)

printf '%s' "$publish_response" | jq -e '.published_count >= 1' >/dev/null

attempt=0
portfolio_response=""
until [ "$attempt" -ge 10 ]; do
  portfolio_response=$(curl_ingress "${BASE_URL}/core/api/paper/portfolio")
  if printf '%s' "$portfolio_response" | jq -e '.portfolio.positions[0].market_price == 65500' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

printf '%s' "$portfolio_response" | jq -e '.portfolio.positions[0].market_price == 65500' >/dev/null

sell_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/data/api/data/strategy/signals/publish" \
    -H 'Content-Type: application/json' \
    -d '{"scenario":"baseline","strategy_id":"baseline-trend","limit":1,"offset":1}'
)

printf '%s' "$sell_response" | jq -e '.published_count == 1' >/dev/null

orders_response=$(curl_ingress "${BASE_URL}/core/api/paper/orders?symbol=BTCUSDT")
printf '%s' "$orders_response" | jq -e '.orders | length >= 2' >/dev/null

report_response=$(curl_ingress "${BASE_URL}/core/api/paper/report")
printf '%s' "$report_response" | jq -e '.report.filled_orders >= 2' >/dev/null

audit_response=$(curl_ingress "${BASE_URL}/core/api/paper/audit?limit=20")
printf '%s' "$audit_response" | jq -e '.events | length >= 5' >/dev/null

timeline_response=$(curl_ingress "${BASE_URL}/core/api/paper/timeline")
printf '%s' "$timeline_response" | jq -e '.timeline | length >= 3' >/dev/null

stop_a_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/paper/session/stop"
)
printf '%s' "$stop_a_response" | jq -e '.session.status == "stopped"' >/dev/null

session_b_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/paper/session/start" \
    -H 'Content-Type: application/json' \
    -d '{"session_id":"smoke-session-b"}'
)
printf '%s' "$session_b_response" | jq -e '.session.id == "smoke-session-b"' >/dev/null

sessions_response=$(curl_ingress "${BASE_URL}/core/api/paper/sessions?limit=10&offset=0")
printf '%s' "$sessions_response" | jq -e '.sessions[0].session_id == "smoke-session-b"' >/dev/null
printf '%s' "$sessions_response" | jq -e '.sessions | map(.session_id) | index("smoke-session-a") != null' >/dev/null

report_by_session=$(curl_ingress "${BASE_URL}/core/api/paper/report?session_id=smoke-session-a")
printf '%s' "$report_by_session" | jq -e '.report.session_id == "smoke-session-a" and .report.filled_orders >= 2' >/dev/null

audit_by_session=$(curl_ingress "${BASE_URL}/core/api/paper/audit?session_id=smoke-session-a&limit=20&offset=0")
printf '%s' "$audit_by_session" | jq -e '.events | length >= 5' >/dev/null

timeline_by_session=$(curl_ingress "${BASE_URL}/core/api/paper/timeline?session_id=smoke-session-a")
printf '%s' "$timeline_by_session" | jq -e '.timeline | length >= 3' >/dev/null

stop_b_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/paper/session/stop"
)
printf '%s' "$stop_b_response" | jq -e '.session.status == "stopped"' >/dev/null

standalone_run_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/sim/runs" \
    -H 'Content-Type: application/json' \
    -d '{"bot_id":"baseline-roundtrip","scenario_id":"baseline"}'
)

standalone_run_id=$(printf '%s' "$standalone_run_response" | jq -r '.run.run_id')
printf '%s' "$standalone_run_response" | jq -e '.run.status == "running"' >/dev/null

attempt=0
standalone_run_detail=""
until [ "$attempt" -ge 30 ]; do
  standalone_run_detail=$(curl_ingress "${BASE_URL}/core/api/sim/runs/${standalone_run_id}")
  if printf '%s' "$standalone_run_detail" | jq -e '.run.status == "completed"' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

printf '%s' "$standalone_run_detail" | jq -e '.run.status == "completed"' >/dev/null

experiment_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/sim/experiments" \
    -H 'Content-Type: application/json' \
    -d '{"name":"k8s smoke experiment","bots":[{"bot_id":"buy-and-hold","bot_version":"v1"}],"scenarios":["trend-up"],"repetitions":2}'
)

experiment_id=$(printf '%s' "$experiment_response" | jq -r '.experiment.experiment_id')
printf '%s' "$experiment_response" | jq -e '.experiment.planned_runs == 2' >/dev/null

attempt=0
experiment_detail=""
until [ "$attempt" -ge 40 ]; do
  experiment_detail=$(curl_ingress "${BASE_URL}/core/api/sim/experiments/${experiment_id}")
  if printf '%s' "$experiment_detail" | jq -e '.experiment.status == "completed"' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

printf '%s' "$experiment_detail" | jq -e '.experiment.status == "completed"' >/dev/null
printf '%s' "$experiment_detail" | jq -e '.experiment.completed_runs == 2 and .experiment.failed_runs == 0 and .experiment.stopped_runs == 0' >/dev/null

summary_response=$(curl_ingress "${BASE_URL}/core/api/sim/experiments/${experiment_id}/summary")
printf '%s' "$summary_response" | jq -e '.rows | length == 1' >/dev/null
printf '%s' "$summary_response" | jq -e '.rows[0].scheduled_runs == 2 and .rows[0].completed_runs == 2' >/dev/null

child_runs_response=$(curl_ingress "${BASE_URL}/core/api/sim/runs?experiment_id=${experiment_id}&limit=10&offset=0")
printf '%s' "$child_runs_response" | jq -e --arg experiment_id "$experiment_id" '.runs | length == 2 and all(.[]; .experiment_id == $experiment_id)' >/dev/null

child_run_id=$(printf '%s' "$child_runs_response" | jq -r '.runs[0].run_id')
child_session_id=$(printf '%s' "$child_runs_response" | jq -r '.runs[0].session_id')

child_run_detail=$(curl_ingress "${BASE_URL}/core/api/sim/runs/${child_run_id}")
printf '%s' "$child_run_detail" | jq -e --arg experiment_id "$experiment_id" '.run.experiment_id == $experiment_id' >/dev/null
printf '%s' "$child_run_detail" | jq -e '.run.execution_profile_snapshot.initial_balance > 0' >/dev/null
printf '%s' "$child_run_detail" | jq -e '.run.market_profile_snapshot.signal_latency_ticks >= 0' >/dev/null

report_response=$(curl_ingress "${BASE_URL}/core/api/paper/report?session_id=${child_session_id}")
printf '%s' "$report_response" | jq -e '.report.filled_orders >= 1' >/dev/null

audit_response=$(curl_ingress "${BASE_URL}/core/api/paper/audit?session_id=${child_session_id}&limit=50&offset=0")
printf '%s' "$audit_response" | jq -e '.events | length >= 1' >/dev/null

timeline_response=$(curl_ingress "${BASE_URL}/core/api/paper/timeline?session_id=${child_session_id}")
printf '%s' "$timeline_response" | jq -e '.timeline | length >= 1' >/dev/null

leaderboard_response=$(curl_ingress "${BASE_URL}/core/api/sim/leaderboard?limit=20&offset=0")
printf '%s' "$leaderboard_response" | jq -e --arg run_id "$standalone_run_id" '.rows | map(.run_id) | index($run_id) != null' >/dev/null

for experiment_run_id in $(printf '%s' "$child_runs_response" | jq -r '.runs[].run_id'); do
  if printf '%s' "$leaderboard_response" | jq -e --arg run_id "$experiment_run_id" '.rows | map(.run_id) | index($run_id) == null' >/dev/null; then
    :
  else
    echo "Experiment child run leaked into leaderboard: ${experiment_run_id}" >&2
    exit 1
  fi
done
