#!/bin/sh

set -eu

SIMULATOR_INGRESS_HOST="${SIMULATOR_INGRESS_HOST:-simulator.localtest.me}"
SIMULATOR_INGRESS_PORT="${SIMULATOR_INGRESS_PORT:-18020}"
K8S_NAMESPACE="${K8S_NAMESPACE:-crypto-simulator}"
RESTORE_SESSION_ID="${RESTORE_SESSION_ID:-restore-session}"
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

wait_for_ingress_stack() {
  wait_for_url "${BASE_URL}/health"
  wait_for_url "${BASE_URL}/core/health"
  wait_for_url "${BASE_URL}/data/health"
  wait_for_url "${BASE_URL}/"
}

wait_for_report_fill() {
  attempts=0

  while [ "$attempts" -lt 20 ]; do
    report_response=$(curl_ingress "${BASE_URL}/core/api/paper/report" || true)
    if printf '%s' "$report_response" | jq -e \
      --arg session_id "$RESTORE_SESSION_ID" \
      '.report.session_id == $session_id and .report.filled_orders >= 1' >/dev/null 2>&1; then
      return 0
    fi

    attempts=$((attempts + 1))
    sleep 1
  done

  echo "Timed out waiting for report fill for session ${RESTORE_SESSION_ID}" >&2
  return 1
}

lookup_core_deployment() {
  kubectl -n "$K8S_NAMESPACE" get deployment \
    -l app.kubernetes.io/component=core-trading \
    -o jsonpath='{.items[0].metadata.name}'
}

wait_for_restored_state() {
  attempts=0

  while [ "$attempts" -lt 30 ]; do
    session_response=$(curl_ingress "${BASE_URL}/core/api/paper/session" || true)
    report_response=$(curl_ingress "${BASE_URL}/core/api/paper/report" || true)
    timeline_response=$(curl_ingress "${BASE_URL}/core/api/paper/timeline" || true)

    if printf '%s' "$session_response" | jq -e \
      --arg session_id "$RESTORE_SESSION_ID" \
      '.session.id == $session_id and .session.status == "running"' >/dev/null 2>&1 &&
      printf '%s' "$report_response" | jq -e \
        --arg session_id "$RESTORE_SESSION_ID" \
        '.report.session_id == $session_id and .report.filled_orders >= 1' >/dev/null 2>&1 &&
      printf '%s' "$timeline_response" | jq -e '.timeline | length >= 2' >/dev/null 2>&1; then
      return 0
    fi

    attempts=$((attempts + 1))
    sleep 2
  done

  echo "Timed out waiting for restored current session state" >&2
  return 1
}

wait_for_ingress_stack

ui_page=$(curl_ingress "${BASE_URL}/")
printf '%s' "$ui_page" | grep -q "Simulator Operator Platform"

session_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/paper/session/start" \
    -H 'Content-Type: application/json' \
    -d "{\"session_id\":\"${RESTORE_SESSION_ID}\"}"
)
printf '%s' "$session_response" | jq -e \
  --arg session_id "$RESTORE_SESSION_ID" \
  '.session.id == $session_id and .session.status == "running"' >/dev/null

signal_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/data/api/data/strategy/signals/publish" \
    -H 'Content-Type: application/json' \
    -d '{"scenario":"baseline","strategy_id":"baseline-trend","limit":1,"offset":0}'
)
printf '%s' "$signal_response" | jq -e '.published_count == 1' >/dev/null

market_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/data/api/data/market/quotes/publish" \
    -H 'Content-Type: application/json' \
    -d '{"scenario":"baseline","transport":"http"}'
)
printf '%s' "$market_response" | jq -e '.published_count >= 1' >/dev/null

wait_for_report_fill

core_deployment="$(lookup_core_deployment)"
if [ -z "$core_deployment" ]; then
  echo "Could not find core-trading deployment in namespace ${K8S_NAMESPACE}" >&2
  exit 1
fi

kubectl -n "$K8S_NAMESPACE" rollout restart "deployment/${core_deployment}"
kubectl -n "$K8S_NAMESPACE" rollout status "deployment/${core_deployment}" --timeout=10m

wait_for_ingress_stack
wait_for_restored_state

session_after=$(curl_ingress "${BASE_URL}/core/api/paper/session")
report_after=$(curl_ingress "${BASE_URL}/core/api/paper/report")
audit_after=$(curl_ingress "${BASE_URL}/core/api/paper/audit?limit=20&offset=0")
timeline_after=$(curl_ingress "${BASE_URL}/core/api/paper/timeline")
sessions_after=$(
  curl_ingress "${BASE_URL}/core/api/paper/sessions?q=${RESTORE_SESSION_ID}&limit=20&offset=0"
)
audit_by_session=$(
  curl_ingress \
    "${BASE_URL}/core/api/paper/audit?session_id=${RESTORE_SESSION_ID}&limit=20&offset=0"
)
timeline_by_session=$(
  curl_ingress "${BASE_URL}/core/api/paper/timeline?session_id=${RESTORE_SESSION_ID}"
)

printf '%s' "$session_after" | jq -e \
  --arg session_id "$RESTORE_SESSION_ID" \
  '.session.id == $session_id and .session.status == "running"' >/dev/null
printf '%s' "$report_after" | jq -e \
  --arg session_id "$RESTORE_SESSION_ID" \
  '.report.session_id == $session_id and .report.filled_orders >= 1' >/dev/null
printf '%s' "$audit_after" | jq -e '.events | length >= 3' >/dev/null
printf '%s' "$timeline_after" | jq -e '.timeline | length >= 2' >/dev/null
printf '%s' "$sessions_after" | jq -e \
  --arg session_id "$RESTORE_SESSION_ID" \
  '.sessions | map(.session_id) | index($session_id) != null' >/dev/null
printf '%s' "$audit_by_session" | jq -e '.events | length >= 3' >/dev/null
printf '%s' "$timeline_by_session" | jq -e '.timeline | length >= 2' >/dev/null

stop_response=$(
  curl_ingress \
    -X POST \
    "${BASE_URL}/core/api/paper/session/stop"
)
printf '%s' "$stop_response" | jq -e '.session.status == "stopped"' >/dev/null
