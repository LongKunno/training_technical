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

session_after=$(curl -fsS http://core_trading:8080/api/paper/session)
report_after=$(curl -fsS http://core_trading:8080/api/paper/report)
audit_after=$(curl -fsS 'http://core_trading:8080/api/paper/audit?limit=20')

printf '%s' "$session_after" | jq -e '.session.id == "restore-session"' >/dev/null
printf '%s' "$report_after" | jq -e '.report.filled_orders >= 1' >/dev/null
printf '%s' "$audit_after" | jq -e '.events | length >= 3' >/dev/null
