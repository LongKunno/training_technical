#!/bin/sh

set -eu

SMOKE_SCRIPT_DIR=$(dirname "$0")
. "${SMOKE_SCRIPT_DIR}/smoke-artifacts.sh"
SMOKE_STARTED_AT=$(smoke_started_at)

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

standalone_run_response=$(
  curl -fsS \
    -X POST \
    http://core_trading:8080/api/sim/runs \
    -H 'Content-Type: application/json' \
    -d '{"bot_id":"baseline-roundtrip","scenario_id":"baseline"}'
)

standalone_run_id=$(printf '%s' "$standalone_run_response" | jq -r '.run.run_id')
printf '%s' "$standalone_run_response" | jq -e '.run.status == "running"' >/dev/null

attempt=0
standalone_run_detail=""
until [ "$attempt" -ge 30 ]; do
  standalone_run_detail=$(curl -fsS "http://core_trading:8080/api/sim/runs/${standalone_run_id}")
  if printf '%s' "$standalone_run_detail" | jq -e '.run.status == "completed"' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

printf '%s' "$standalone_run_detail" | jq -e '.run.status == "completed"' >/dev/null

experiment_response=$(
  curl -fsS \
    -X POST \
    http://core_trading:8080/api/sim/experiments \
    -H 'Content-Type: application/json' \
    -d '{"name":"Smoke experiment","bots":[{"bot_id":"buy-and-hold","bot_version":"v1"}],"scenarios":["trend-up"],"repetitions":2}'
)

experiment_id=$(printf '%s' "$experiment_response" | jq -r '.experiment.experiment_id')
printf '%s' "$experiment_response" | jq -e '.experiment.planned_runs == 2' >/dev/null

attempt=0
experiment_detail=""
until [ "$attempt" -ge 40 ]; do
  experiment_detail=$(curl -fsS "http://core_trading:8080/api/sim/experiments/${experiment_id}")
  if printf '%s' "$experiment_detail" | jq -e '.experiment.status == "completed"' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep 1
done

printf '%s' "$experiment_detail" | jq -e '.experiment.status == "completed"' >/dev/null
printf '%s' "$experiment_detail" | jq -e '.experiment.completed_runs == 2 and .experiment.failed_runs == 0 and .experiment.stopped_runs == 0' >/dev/null

summary_response=$(curl -fsS "http://core_trading:8080/api/sim/experiments/${experiment_id}/summary")
printf '%s' "$summary_response" | jq -e '.rows | length == 1' >/dev/null
printf '%s' "$summary_response" | jq -e '.rows[0].scheduled_runs == 2 and .rows[0].completed_runs == 2' >/dev/null

child_runs_response=$(curl -fsS "http://core_trading:8080/api/sim/runs?experiment_id=${experiment_id}&limit=10&offset=0")
printf '%s' "$child_runs_response" | jq -e --arg experiment_id "$experiment_id" '.runs | length == 2 and all(.[]; .experiment_id == $experiment_id)' >/dev/null

child_run_id=$(printf '%s' "$child_runs_response" | jq -r '.runs[0].run_id')
child_session_id=$(printf '%s' "$child_runs_response" | jq -r '.runs[0].session_id')

child_run_detail=$(curl -fsS "http://core_trading:8080/api/sim/runs/${child_run_id}")
printf '%s' "$child_run_detail" | jq -e --arg experiment_id "$experiment_id" '.run.experiment_id == $experiment_id' >/dev/null
printf '%s' "$child_run_detail" | jq -e '.run.execution_profile_snapshot.initial_balance > 0' >/dev/null
printf '%s' "$child_run_detail" | jq -e '.run.market_profile_snapshot.signal_latency_ticks >= 0' >/dev/null

report_response=$(curl -fsS "http://core_trading:8080/api/paper/report?session_id=${child_session_id}")
printf '%s' "$report_response" | jq -e '.report.filled_orders >= 1' >/dev/null

audit_response=$(curl -fsS "http://core_trading:8080/api/paper/audit?session_id=${child_session_id}&limit=50&offset=0")
printf '%s' "$audit_response" | jq -e '.events | length >= 1' >/dev/null

timeline_response=$(curl -fsS "http://core_trading:8080/api/paper/timeline?session_id=${child_session_id}")
printf '%s' "$timeline_response" | jq -e '.timeline | length >= 1' >/dev/null

leaderboard_response=$(curl -fsS "http://core_trading:8080/api/sim/leaderboard?limit=20&offset=0")
printf '%s' "$leaderboard_response" | jq -e --arg run_id "$standalone_run_id" '.rows | map(.run_id) | index($run_id) != null' >/dev/null

for experiment_run_id in $(printf '%s' "$child_runs_response" | jq -r '.runs[].run_id'); do
  if printf '%s' "$leaderboard_response" | jq -e --arg run_id "$experiment_run_id" '.rows | map(.run_id) | index($run_id) == null' >/dev/null; then
    :
  else
    echo "Experiment child run leaked into leaderboard: ${experiment_run_id}" >&2
    exit 1
  fi
done

smoke_write_artifact \
  "simulation-experiment" \
  "passed" \
  '{standalone_run_id: $standalone_run_id, experiment_id: $experiment_id, child_run_count: ($child_runs_response | fromjson | .runs | length), completed_runs: ($experiment_detail | fromjson | .experiment.completed_runs), summary_rows: ($summary_response | fromjson | .rows | length), avg_total_pnl: ($summary_response | fromjson | .rows[0].avg_total_pnl), confidence_interval_95_total_pnl: ($summary_response | fromjson | .rows[0].confidence_interval_95_total_pnl)}' \
  --arg standalone_run_id "$standalone_run_id" \
  --arg experiment_id "$experiment_id" \
  --arg child_runs_response "$child_runs_response" \
  --arg experiment_detail "$experiment_detail" \
  --arg summary_response "$summary_response"
