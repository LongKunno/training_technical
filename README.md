# Crypto Trading Simulator

Repo này đang đi theo hướng `simulator-first`: ưu tiên `paper trading`, `market data mock/replay`, session mô phỏng và local dev sạch trong Docker trước khi nghĩ tới trading thật.

## Snapshot hiện tại

- `services/core-trading-go`
  - paper trading engine với `fee/slippage`, `mark price`, `session lifecycle`, `signal contract`, `risk controls`, `audit trail`, `session report`
  - HTTP APIs cho `account`, `portfolio`, `positions`, `rules`, `orders`
  - internal APIs cho `market price ingest` và `signals`
  - Postgres state store v1 và Kafka consumer tùy chọn
- `services/data-pipeline-py`
  - mock market data service với `latest quote`, `publish latest`, `replay theo scenario/speed`
  - strategy mock service với `signal list`, `publish slice`, `replay scenario`
  - HTTP publish sang Go internal ingest
  - Kafka publish tùy chọn cho `PriceTickV1`
- `services/simulator-ui`
  - dashboard nội bộ v1 để điều khiển session, market replay, strategy publish, audit feed và report
  - reverse proxy sang Go/Python services qua `/core/*` và `/data/*`
- `docker-compose.yml`
  - `postgres`, `redis`, `kafka`, `migrations`, `core_trading`, `data_pipeline`, `simulator_ui`, `smoke_runner`
- Host ports mặc định
  - `core_trading` -> `http://localhost:18080`
  - `data_pipeline` -> `http://localhost:18000`
  - `simulator_ui` -> `http://localhost:18020`

## Tài liệu nên đọc

- [Hướng dẫn vận hành cho AI](docs/ai-operating-guide.md)
- [Theo dõi tiến độ hiện tại](docs/progress-tracker.md)
- [Kiến trúc hệ thống chi tiết](docs/architecture.md)
- [Ánh xạ roadmap](docs/roadmap_mapping.md)
- [Rule Docker-only test](.antigravityrules)

## Khởi động nhanh

```bash
cp .env.example .env
make up
```

Health checks:

```bash
curl http://localhost:18080/health
curl http://localhost:18000/health
```

Dashboard: `http://localhost:18020`

## API nhanh để thử tay

Session paper trading:

```bash
curl http://localhost:18080/api/paper/rules
curl http://localhost:18080/api/paper/session
curl -X POST http://localhost:18080/api/paper/session/start \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"manual-session"}'
```

Paper trading:

```bash
curl http://localhost:18080/api/paper/account
curl http://localhost:18080/api/paper/portfolio
curl http://localhost:18080/api/paper/positions
curl 'http://localhost:18080/api/paper/orders?limit=10&offset=0'
curl -X POST http://localhost:18080/api/paper/orders \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}'
curl -X POST http://localhost:18080/internal/signals \
  -H 'Content-Type: application/json' \
  -d '{"strategy_id":"manual","signal_id":"sig-1","symbol":"BTCUSDT","side":"buy","notional":100,"price_hint":100,"timestamp":"2026-04-17T00:00:00Z"}'
```

Market data mock/replay:

```bash
curl 'http://localhost:18000/api/data/market/quotes/latest?symbol=BTCUSDT&scenario=baseline'
curl http://localhost:18000/api/data/market/quotes/replay/scenarios
curl -X POST http://localhost:18000/api/data/market/quotes/publish \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"baseline"}'
curl -X POST http://localhost:18000/api/data/market/quotes/replay \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"volatility-spike","speed_multiplier":0}'
```

Strategy mock:

```bash
curl http://localhost:18000/api/data/strategy/signals/scenarios
curl 'http://localhost:18000/api/data/strategy/signals?scenario=baseline'
curl -X POST http://localhost:18000/api/data/strategy/signals/publish \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"baseline","strategy_id":"baseline-trend","limit":1,"offset":0}'
curl -X POST http://localhost:18000/api/data/strategy/signals/replay \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"volatility-spike","speed_multiplier":0}'
```

Audit và report:

```bash
curl 'http://localhost:18080/api/paper/audit?limit=20&offset=0'
curl http://localhost:18080/api/paper/report
```

## Verify trong Docker

Mọi loại test và smoke chỉ được chạy trong Docker.

```bash
make lint-go
make lint-py
make test-go
make test-py
make smoke-paper
make smoke-paper-kafka
make smoke-restore
```

Smoke flow hiện tại verify chuỗi:

```text
UI root -> start session -> publish strategy signal -> publish mock price -> portfolio -> sell signal -> audit/report -> stop session
```

## Cleanup

```bash
make clean-docker
make clean-docker-all
```

`make clean-docker-all` sẽ xóa cả named volumes của compose, gồm dữ liệu local của Postgres và Kafka trong stack này.
