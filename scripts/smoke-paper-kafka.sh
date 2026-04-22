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

curl -fsS \
  -X POST \
  http://core_trading:8080/api/paper/session/start \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"smoke-kafka-session"}' >/dev/null

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
    http://data_pipeline:8000/api/data/market/quotes/publish \
    -H 'Content-Type: application/json' \
    -d '{"scenario":"baseline","symbols":["BTCUSDT"],"transport":"kafka"}'
)
printf '%s' "$publish_response" | jq -e '.transports == ["kafka"]' >/dev/null

attempt=0
portfolio_response=""
until [ "$attempt" -ge 20 ]; do
  portfolio_response=$(curl -fsS http://core_trading:8080/api/paper/portfolio)
  if printf '%s' "$portfolio_response" | jq -e '.portfolio.positions[0].market_price == 65500' >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  if [ $((attempt % 5)) -eq 0 ]; then
    retry_publish_response=$(
      curl -fsS \
        -X POST \
        http://data_pipeline:8000/api/data/market/quotes/publish \
        -H 'Content-Type: application/json' \
        -d '{"scenario":"baseline","symbols":["BTCUSDT"],"transport":"kafka"}'
    )
    printf '%s' "$retry_publish_response" | jq -e '.transports == ["kafka"]' >/dev/null
  fi
  sleep 1
done

printf '%s' "$portfolio_response" | jq -e '.portfolio.positions[0].market_price == 65500' >/dev/null
