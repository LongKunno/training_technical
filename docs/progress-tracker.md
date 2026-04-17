# Progress Tracker

Đây là snapshot sống của implementation thật trong repo. Nếu docs khác source code, ưu tiên source code rồi cập nhật lại file này.

## 1. Current Snapshot

`Last updated`: 2026-04-17

### Những gì đang có thật trong repo

- Go service tại `services/core-trading-go` đã có:
  - `GET /health`
  - `GET /api/paper/account`
  - `GET /api/paper/portfolio`
  - `GET /api/paper/positions`
  - `GET /api/paper/rules`
  - `GET /api/paper/session`
  - `POST /api/paper/session/start`
  - `POST /api/paper/session/reset`
  - `POST /api/paper/session/stop`
  - `GET /api/paper/audit`
  - `GET /api/paper/report`
  - `GET /api/paper/orders`
  - `POST /api/paper/orders`
  - `POST /internal/market/prices`
  - `POST /internal/signals`
- Paper trading API của Go đã chuẩn hóa error envelope theo dạng:
  - `{"error":{"code":"...","message":"..."}}`
- Go paper trading core hiện có:
  - rule `fee/slippage` từ runtime env
  - `session lifecycle` cho simulator
  - `signal contract` nội bộ kiểu `SignalV1`
  - `risk controls` cho symbol, position size, order notional, daily loss, cooldown, open exposure
  - `audit trail` theo phiên
  - `session report` gồm PnL, fee, slippage cost, drawdown, orders theo symbol
  - `mark price` tách biệt khỏi `last trade price`
  - rollback state nếu persist xuống store thất bại
- `GET /api/paper/orders` đã hỗ trợ:
  - `symbol`
  - `side`
  - `limit` mặc định `50`, tối đa `200`
  - `offset` mặc định `0`
- Go đã có Postgres persistence v1 cho paper trading state:
  - `paper_accounts`
  - `paper_orders`
  - `paper_positions`
  - `market_prices`
- Go đã có Postgres persistence mở rộng cho runtime simulator:
  - `paper_sessions`
  - `paper_audit_events`
  - restore `session`, `audit`, `report snapshot`, `processed signal ids` sau restart
- Go đã có Kafka consumer cho `PriceTickV1`, và consumer hiện commit/continue thay vì dừng hẳn khi tick bị reject.
- Python service tại `services/data-pipeline-py` đã có:
  - `GET /health`
  - `GET /api/data/market/quotes/latest?symbol=...&scenario=...`
  - `GET /api/data/market/quotes/replay/scenarios`
  - `POST /api/data/market/quotes/publish`
  - `POST /api/data/market/quotes/replay`
  - `GET /api/data/strategy/signals/scenarios`
  - `GET /api/data/strategy/signals?scenario=...`
  - `POST /api/data/strategy/signals/publish`
  - `POST /api/data/strategy/signals/replay`
  - mock fixture loader từ JSON
  - replay ticks theo `scenario` và `speed_multiplier`
  - replay/publish signals theo scenario
  - HTTP publish sang Go internal ingest
  - Kafka publish tùy chọn từ cùng payload tick
- `docker-compose.yml` hiện có:
  - `postgres`
  - `redis`
  - `kafka`
  - `migrations`
  - `core_trading`
  - `data_pipeline`
  - `simulator_ui`
  - `smoke_runner`
- Host ports mặc định cho app services:
  - `core_trading` -> `18080`
  - `data_pipeline` -> `18000`
  - `simulator_ui` -> `18020`
- Infra services không expose port ra host mặc định, chỉ giao tiếp trong Docker network để giảm xung đột cục bộ.
- Repo đã có:
  - `.golangci.yml`
  - `ruff` config
  - GitHub Actions workflow `docker-ci`
  - smoke script liên service
  - dashboard nội bộ v1 ở `services/simulator-ui`
  - `.antigravityrules` tối giản chỉ giữ rule `Docker-only test`

### Những gì đã verify thành công trong Docker

- `make lint-go` pass
- `make lint-py` pass
- `make test-go` pass
- `make test-py` pass
- `make smoke-paper` pass
- `make smoke-paper-kafka` pass
- `make smoke-restore` pass

## 2. Working Commands

### Chạy stack local

```bash
cp .env.example .env
make up
```

### Health check mặc định

```bash
curl http://localhost:18080/health
curl http://localhost:18000/health
```

### Dashboard

```bash
http://localhost:18020
```

### Kiểm tra session và paper trading API

```bash
curl http://localhost:18080/api/paper/rules
curl http://localhost:18080/api/paper/session
curl -X POST http://localhost:18080/api/paper/session/start \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"manual-session"}'
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
curl 'http://localhost:18080/api/paper/audit?limit=20&offset=0'
curl http://localhost:18080/api/paper/report
```

### Kiểm tra mock market data API

```bash
curl 'http://localhost:18000/api/data/market/quotes/latest?symbol=BTCUSDT&scenario=baseline'
curl http://localhost:18000/api/data/market/quotes/replay/scenarios
curl -X POST http://localhost:18000/api/data/market/quotes/publish \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"baseline","transport":"http"}'
curl -X POST http://localhost:18000/api/data/market/quotes/replay \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"volatility-spike","speed_multiplier":0,"transport":"kafka"}'
```

### Kiểm tra strategy mock API

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

### Verify chất lượng

Mọi loại test và verify logic đều phải chạy trong Docker.

```bash
make lint-go
make lint-py
make test-go
make test-py
make test
make smoke-paper
make smoke-paper-kafka
make smoke-restore
```

### Migration

```bash
make migrate-up
make migrate-down
```

### Cleanup

```bash
make clean-docker
make clean-docker-all
```

## 3. Recent Changes

- 2026-04-17: Chuẩn hóa paper trading API contract trong Go, gồm error envelope, status code và filter/pagination cho orders.
- 2026-04-17: Thêm `GET /api/paper/rules`, `GET /api/paper/positions` và `POST /internal/market/prices`.
- 2026-04-17: Thêm mark price state trong Go engine và nối portfolio valuation với market data ngoài luồng order.
- 2026-04-17: Nâng Python service thành mock market data service với latest quote, latest publish, replay theo scenario/speed và bridge HTTP sang Go.
- 2026-04-17: Thêm Postgres state store, migration files và bootstrap load state cho Go paper trading engine.
- 2026-04-17: Mở rộng persistence sang `paper_sessions` và `paper_audit_events`, đồng thời restore session/audit/report sau restart.
- 2026-04-17: Thêm Kafka consumer bên Go và Kafka publish path bên Python, kèm `transport` selector cho market publish/replay.
- 2026-04-17: Thêm `session lifecycle`, `SignalV1`, `risk controls`, `audit trail` và `session report` cho simulator.
- 2026-04-17: Thêm strategy mock flow ở Python với signal fixtures, publish slice và replay.
- 2026-04-17: Thêm dashboard nội bộ v1 chạy trong Docker qua service `simulator_ui`.
- 2026-04-17: Mở rộng smoke flow sang chuỗi `UI -> start session -> publish strategy signal -> publish price -> report/audit -> stop session`, đồng thời thêm smoke riêng cho Kafka path và restore path.
- 2026-04-17: Chốt `Docker-only` verification cho `lint-go`, `lint-py`, `test-go`, `test-py`, `smoke-paper`, `smoke-paper-kafka`, `smoke-restore`.

## 4. Next Recommended Slices

1. Nếu muốn dashboard sâu hơn, bước hợp lý tiếp theo là thêm timeline chart cho equity/drawdown thay vì chỉ snapshot hiện tại.
2. Nếu muốn tái hiện multi-session rõ ràng hơn, thêm endpoint liệt kê lịch sử sessions thay vì chỉ load latest session.
3. Nếu local dev cần nhanh hơn, cân nhắc cache hoặc prebuilt image riêng cho `golangci-lint` để khỏi cài lại trong mỗi lượt `make lint-go`.
4. Nếu muốn tiến tới phase tiếp theo, có thể thêm alerting/risk monitor panel và strategy comparison view trên dashboard.

## 5. Open Risks / Decisions

- `StateStore.SaveState` hiện xóa và ghi lại `paper_orders`, `paper_positions`, `market_prices`, và audit rows của current session để đồng bộ với session reset; cách này phù hợp local simulator v1 nhưng chưa tối ưu cho throughput cao.
- Session history đã được lưu, nhưng API public hiện vẫn chỉ expose `current session` thay vì list nhiều phiên.
- Dashboard hiện là `operator console` dùng static UI + nginx proxy; đủ dùng cho local dev nhưng chưa có auth, charting sâu hay websocket updates.
- `make lint-go` vẫn cài `golangci-lint` trong container mỗi lần chạy để giữ đúng Go toolchain; sạch cho host nhưng tốn thời gian hơn một chút.

## 6. Update Checklist

Sau mỗi task có ý nghĩa, cập nhật file này nếu có thay đổi về:

- trạng thái implementation
- lệnh chạy hoặc lệnh verify
- milestone đã xong
- blocker mới
- quyết định kiến trúc mới
