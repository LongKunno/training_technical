# Progress Tracker

Đây là snapshot sống của implementation thật trong repo. Nếu docs khác source code, ưu tiên source code rồi cập nhật lại file này.

## 1. Current Snapshot

`Last updated`: 2026-04-21

### Những gì đang có thật trong repo

- Go service tại `services/core-trading-go` đã có:
  - `GET /health`
  - `GET /api/paper/account`
  - `GET /api/paper/portfolio`
  - `GET /api/paper/positions`
  - `GET /api/paper/rules`
  - `GET /api/paper/session`
  - `GET /api/paper/sessions`
  - `POST /api/paper/session/start`
  - `POST /api/paper/session/reset`
  - `POST /api/paper/session/stop`
  - `GET /api/paper/audit`
  - `GET /api/paper/report`
  - `GET /api/paper/timeline`
  - `GET /api/paper/orders`
  - `GET /api/sim/bots`
  - `GET /api/sim/bots/:botId`
  - `GET /api/sim/runs`
  - `GET /api/sim/leaderboard`
  - `GET /api/sim/experiments`
  - `GET /api/sim/runs/:runId`
  - `GET /api/sim/experiments/:experimentId`
  - `GET /api/sim/experiments/:experimentId/summary`
  - `POST /api/sim/runs`
  - `POST /api/sim/experiments`
  - `POST /api/sim/experiments/:experimentId/stop`
  - `POST /api/sim/runs/:runId/stop`
  - `POST /api/paper/orders`
  - `POST /internal/market/prices`
  - `POST /internal/signals`
  - `POST /internal/sim/runs/:runId/status`
- Paper trading API của Go đã chuẩn hóa error envelope theo dạng:
  - `{"error":{"code":"...","message":"..."}}`
- Go paper trading core hiện có:
  - rule `fee/slippage` từ runtime env
  - `session lifecycle` cho simulator
  - `signal contract` nội bộ kiểu `SignalV1`
  - `risk controls` cho symbol, position size, order notional, daily loss, cooldown, open exposure
  - `audit trail` theo phiên
  - `session report` gồm PnL, fee, slippage cost, drawdown, orders theo symbol
  - session history summary và truy vấn `report/audit/timeline` theo `session_id`
  - timeline equity/drawdown theo event và SSE stream cho current session
  - simulation run domain gắn `run_id` -> `session_id` để bot experiments tái dùng trực tiếp session report/audit/timeline
  - `CreateRunRequest` hỗ trợ cả `bot_config` lẫn alias cũ `config`, và nhận `execution_profile` per run
  - `run detail` persist `execution_profile_snapshot`, `market_profile_snapshot`, `metrics_snapshot`, `stopped_reason`
  - run list filter thêm `bot_id`, `bot_version`, `scenario_id`, `experiment_id`
  - experiment coordinator chạy tuần tự từng child run, tạo child run just-in-time, stop/resume được sau restart, và aggregate summary theo `(bot_id, bot_version, scenario_id)`
  - leaderboard completed-runs sắp theo `total_pnl DESC`, `max_drawdown ASC`, `updated_at DESC` và chỉ nhận completed standalone runs
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
  - `simulation_bots`
  - `simulation_bot_versions`
  - `simulation_runs`
  - `simulation_experiments`
  - migrations tới `0007_extend_simulation_runs_for_heartbeat`
  - restore `session`, `audit`, `report snapshot`, `processed signal ids` sau restart
  - timeline được lưu trong `report_snapshot` để đọc lại theo session history
  - runtime execution realism v1 persist thêm `market_profile_snapshot`, `pending execution snapshot`, `requested_quantity/notional`, `remaining_quantity`, `fill_count`, `terminal_reason`
  - simulation coordinator hỗ trợ queued experiments, runner heartbeat, và fail stale run với `runner_lost`
- Go đã có Kafka consumer cho `PriceTickV1`, và consumer hiện commit/continue thay vì dừng hẳn khi tick bị reject.
- Python service tại `services/data-pipeline-py` đã có:
  - `GET /health`
  - `GET /api/data/market/quotes/latest?symbol=...&scenario=...`
  - `GET /api/data/market/quotes/replay?scenario=...`
  - `GET /api/data/market/quotes/replay/scenarios`
  - `GET /api/data/market/quotes/replay/catalog`
  - `GET /api/data/market/quotes/replay/catalog/:scenario_id`
  - `POST /api/data/market/quotes/publish`
  - `POST /api/data/market/quotes/replay`
  - `GET /api/data/strategy/signals/scenarios`
  - `GET /api/data/strategy/signals?scenario=...`
  - `POST /api/data/strategy/signals/publish`
  - `POST /api/data/strategy/signals/replay`
  - mock fixture loader từ JSON
  - replay ticks theo `scenario` và `speed_multiplier`
  - scenario catalog metadata cho benchmark selection:
    - `baseline`
    - `trend-up`
    - `flash-crash-recovery`
    - `range-chop`
    - `volatility-spike`
  - replay/publish signals theo scenario
  - HTTP publish sang Go internal ingest
  - Kafka publish tùy chọn từ cùng payload tick
  - internal ops benchmark endpoints:
    - `POST /internal/ops/benchmark/cpu`
    - `POST /internal/ops/benchmark/memory`
  - benchmark endpoints chỉ mở khi `OPS_BENCHMARK_ENABLED=true` và token hợp lệ qua header `X-Ops-Token`
- Python service tại `services/bot-runner-py` đã có:
  - `GET /health`
  - `POST /internal/runs/start`
  - `POST /internal/runs/:runId/stop`
  - background execution loop lấy replay ticks từ `data_pipeline`
  - publish market ticks + signals sang `core_trading`
  - callback `running/completed/stopped/failed` về `core_trading`
  - built-in bots:
    - `baseline-roundtrip:v1`
    - `buy-and-hold:v1`
    - `moving-average-cross:v1`
- `docker-compose.yml` hiện có:
  - `postgres`
  - `redis`
  - `kafka`
  - `migrations`
  - `core_trading`
  - `data_pipeline`
  - `bot_runner`
  - `simulator_ui`
  - `smoke_runner`
- Repo đã có thêm `docker-compose.ui-dev.yml` để override `simulator_ui` sang Vite dev server với hot reload nhưng vẫn giữ host port `18020`.
- Repo đã có thêm `docker-compose.ui-e2e.yml` để chạy `ui_e2e_runner` cho `vitest` và `playwright` trong Docker.
- Repo đã có local K8s runtime scaffold:
  - `k8s/kind/cluster.yaml` để dựng `kind` cluster với ingress map ra host port `18020` và NodePort demo map ra `18021`
  - `scripts/k8s-bootstrap-addons.sh` bootstrap `ingress-nginx`, `metrics-server`, và `MetalLB`
  - `k8s/helm/crypto-simulator` để deploy `postgres`, `redis`, `kafka`, `migrations`, `core_trading`, `data_pipeline`, `bot_runner`, `simulator_ui`
  - chart đã có:
    - persistence mặc định cho `Postgres` và `Kafka`
    - profile `values-dev-ephemeral`, `values-ha`, `values-exposure-nodeport`, `values-exposure-lb`, `values-static-pv-demo`
    - exposure mode `ingress | nodePort | loadBalancer` cho `simulator_ui`
    - rollout strategy, `PodDisruptionBudget`, `HorizontalPodAutoscaler` cho `data_pipeline`
  - ingress vẫn là public mode mặc định; browser đi same-origin qua `/core/*` và `/data/*`
- Repo đã có infra manifests cho local K8s:
  - `k8s/infrastructure/metallb/l2advertisement.yaml`
  - `k8s/infrastructure/storage/postgres-static-pv.yaml`
  - `k8s/infrastructure/storage/postgres-static-pvc.yaml`
- Repo đã có production Dockerfiles riêng cho:
  - `services/core-trading-go/Dockerfile`
  - `services/data-pipeline-py/Dockerfile`
- Host ports mặc định cho app services:
  - `core_trading` -> `18080`
  - `data_pipeline` -> `18000`
  - `simulator_ui` -> `18020`
- Host entrypoint mặc định cho local K8s:
  - `simulator.localtest.me:18020`
- Host entrypoint mặc định cho NodePort demo:
  - `localhost:18021`
- Infra services không expose port ra host mặc định, chỉ giao tiếp trong Docker network để giảm xung đột cục bộ.
- Repo đã có:
  - `.golangci.yml`
  - `ruff` config
  - GitHub Actions workflow `docker-ci`
  - GitHub Actions workflow `k8s-ci` cho `helm lint/template` và `kind` smoke/restore smoke
  - smoke script liên service
  - frontend app thật ở `services/simulator-ui` dùng `React + Vite + TypeScript`
  - Node runtime serve build, expose `GET /health`, và proxy `/core/*`, `/data/*`
  - App shell/Lab/Dashboard surface trạng thái `/core/health`, `/data/health`, và current-session SSE; operator controls degrade rõ ràng khi upstream down
  - runtime UI chặn browser access tới `/core/internal/ops*` và `/data/internal/ops*`
  - route map `dashboard`, `sessions`, `sessions/:sessionId`, `lab`
  - route map mở rộng thêm `runs`, `runs/:runId`, `experiments`, `experiments/:experimentId`, `leaderboard`
  - `/runs` và `/experiments` là hai workflow khác nhau; `/leaderboard` giữ semantics standalone only
  - current session live monitor tách khỏi historical session views
  - charts dùng `ECharts`, shared API/query/state layer dùng `TanStack Query + Zustand`
  - FE quality gates: `typecheck`, `lint`, `vitest` trong Docker runner, mocked `playwright` trong Docker runner, và compose-backed `playwright.live` cho backend thật
  - `.antigravityrules` tối giản chỉ giữ rule `Docker-only test`

### Những gì đã verify thành công trong Docker

- `make lint-go` pass
- `make lint-py` pass
- `make test-go` pass
- `make test-py` pass
- `make test-bot-runner` pass
- `make typecheck-ui` pass
- `make lint-ui` pass
- `make test-ui` pass
- `make build-ui` pass
- `make test-e2e-ui` pass
- `make test-e2e-ui-live` pass
- `make smoke-paper` pass
- `make smoke-paper-kafka` pass
- `make smoke-restore` pass
- `make smoke-sim-run` pass
- `make smoke-sim-experiment` pass
- `docker run --rm -v "$PWD":/work -w /work alpine/helm:3.16.4 lint ./k8s/helm/crypto-simulator` pass
- `docker run --rm -v "$PWD":/work -w /work alpine/helm:3.16.4 template crypto-simulator ./k8s/helm/crypto-simulator` pass
- `docker run --rm -v "$PWD":/work -w /work alpine/helm:3.16.4 template crypto-simulator ./k8s/helm/crypto-simulator --values ./k8s/helm/crypto-simulator/values-ha.yaml` pass
- `docker run --rm -v "$PWD":/work -w /work alpine/helm:3.16.4 template crypto-simulator ./k8s/helm/crypto-simulator --values ./k8s/helm/crypto-simulator/values-exposure-nodeport.yaml` pass
- `docker run --rm -v "$PWD":/work -w /work alpine/helm:3.16.4 template crypto-simulator ./k8s/helm/crypto-simulator --values ./k8s/helm/crypto-simulator/values-exposure-lb.yaml` pass
- `docker run --rm -v "$PWD":/work -w /work alpine/helm:3.16.4 template crypto-simulator ./k8s/helm/crypto-simulator --values ./k8s/helm/crypto-simulator/values-static-pv-demo.yaml` pass
- `docker build -f services/core-trading-go/Dockerfile -t crypto-simulator/core-trading:dev services/core-trading-go` pass
- `docker build -f services/data-pipeline-py/Dockerfile -t crypto-simulator/data-pipeline:dev services/data-pipeline-py` pass
- `docker build -f services/bot-runner-py/Dockerfile -t crypto-simulator/bot-runner:dev services/bot-runner-py` pass
- `docker build -f services/simulator-ui/Dockerfile -t crypto-simulator/simulator-ui:dev services/simulator-ui` pass
- `make k8s-deploy` pass trên `kind` cluster verify tạm
- `make k8s-smoke` pass qua ingress host `simulator.localtest.me:18020`

## 2. Working Commands

### Chạy local bằng K8s `kind + Helm`

```bash
cp .env.example .env
make k8s-kind-up
make k8s-build-images
make k8s-load-images
make k8s-lint
make k8s-template
make k8s-deploy
make k8s-smoke
make k8s-smoke-restore
```

### K8s demos / profiles

```bash
make k8s-deploy K8S_VALUES_EXTRA='./k8s/helm/crypto-simulator/values-dev-ephemeral.yaml'
make k8s-deploy K8S_VALUES_EXTRA='./k8s/helm/crypto-simulator/values-ha.yaml'
make k8s-hpa-demo-cpu
make k8s-hpa-demo-memory
make k8s-rollout-demo
make k8s-exposure-nodeport-demo
make k8s-exposure-lb-demo
make k8s-static-pv-demo
```

### Xem trạng thái K8s

```bash
make k8s-status
```

### Chạy stack local bằng Docker Compose fallback

```bash
cp .env.example .env
make up
```

### Chạy UI dev với hot reload trong Docker

```bash
cp .env.example .env
make up-ui-dev
```

### Health check mặc định

```bash
curl http://localhost:18080/health
curl http://localhost:18000/health
curl http://localhost:18020/health
```

### Dashboard

```bash
http://localhost:18020
http://simulator.localtest.me:18020
```

### Frontend quality gates

```bash
make typecheck-ui
make lint-ui
make test-ui
make build-ui
make test-e2e-ui
make test-e2e-ui-live
make test-e2e-ui-restore
```

### Bot runner quality gates

```bash
make test-bot-runner
make lint-bot-runner
```

### Smoke nhanh cho UI runtime/dev

```bash
make smoke-ui-runtime
make smoke-ui-dev
make k8s-smoke
```

`make test-e2e-ui-live` và `make test-e2e-ui-restore` hiện tự cleanup compose stack sau khi chạy xong, kể cả khi Playwright fail.

### Kiểm tra session và paper trading API

```bash
curl http://localhost:18080/api/paper/rules
curl http://localhost:18080/api/paper/session
curl 'http://localhost:18080/api/paper/sessions?limit=20&offset=0'
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
curl 'http://localhost:18080/api/paper/report?session_id=manual-session'
curl 'http://localhost:18080/api/paper/audit?session_id=manual-session&limit=20&offset=0'
curl 'http://localhost:18080/api/paper/timeline?session_id=manual-session'
```

### Kiểm tra simulation runs API

```bash
curl http://localhost:18080/api/sim/bots
curl 'http://localhost:18080/api/sim/runs?limit=20&offset=0'
curl 'http://localhost:18080/api/sim/runs?bot_id=buy-and-hold&bot_version=v1&scenario_id=trend-up&limit=20&offset=0'
curl 'http://localhost:18080/api/sim/runs?experiment_id=sim-exp-123&limit=20&offset=0'
curl 'http://localhost:18080/api/sim/leaderboard?limit=20&offset=0'
curl 'http://localhost:18080/api/sim/experiments?limit=20&offset=0'
curl -X POST http://localhost:18080/api/sim/runs \
  -H 'Content-Type: application/json' \
  -d '{"bot_id":"buy-and-hold","scenario_id":"trend-up","bot_config":{"trade_notional":750,"tick_interval_ms":0},"execution_profile":{"initial_balance":15000,"fee_rate":0.0015,"slippage_rate":0.0025}}'
curl http://localhost:18080/api/sim/runs/sim-run-123
curl http://localhost:18080/api/sim/experiments/sim-exp-123
curl http://localhost:18080/api/sim/experiments/sim-exp-123/summary
curl -X POST http://localhost:18080/api/sim/experiments \
  -H 'Content-Type: application/json' \
  -d '{"name":"baseline-matrix","bots":[{"bot_id":"buy-and-hold","bot_version":"v1"}],"scenarios":["trend-up"],"repetitions":2}'
curl -X POST http://localhost:18080/api/sim/experiments/sim-exp-123/stop
```

### Kiểm tra mock market data API

```bash
curl 'http://localhost:18000/api/data/market/quotes/latest?symbol=BTCUSDT&scenario=baseline'
curl 'http://localhost:18000/api/data/market/quotes/replay?scenario=baseline'
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
make test-bot-runner
make test
make smoke-paper
make smoke-paper-kafka
make smoke-restore
make smoke-sim-run
make smoke-sim-experiment
```

### Verify local K8s runtime

```bash
make k8s-kind-up
make k8s-build-images
make k8s-load-images
make k8s-deploy
make k8s-smoke
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
make down-ui-dev
make k8s-kind-down
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
- 2026-04-18: Mở rộng Go/UI với `GET /api/paper/sessions`, `report/audit/timeline` theo `session_id`, SSE timeline cho current session, session history panel và selected-session detail trên dashboard.
- 2026-04-18: Rebuild `services/simulator-ui` thành app `React + Vite + TypeScript` với Node runtime, route-level operator UX, shared query/state layer và charting bằng `ECharts`.
- 2026-04-18: Thêm `GET /health` cho Node runtime của `simulator_ui`, healthcheck cho compose, và `docker-compose.ui-dev.yml` để chạy Vite hot reload trên cùng host port `18020`.
- 2026-04-18: Thêm smoke scripts riêng cho `simulator_ui` runtime/dev để verify entrypoint và proxy `/core`, `/data` ngoài các smoke flow paper trading chính.
- 2026-04-18: Thêm `Dockerfile.e2e`, `docker-compose.ui-e2e.yml`, và `ui_e2e_runner` để chạy `vitest` cùng `playwright` trong Docker; bổ sung live Playwright spec cho `/dashboard` và `/sessions` trên backend thật.
- 2026-04-18: Bọc `make test-e2e-ui-live` bằng script có `trap` teardown để không để lại compose stack treo, đồng thời mở rộng live acceptance cho case historical detail không bị current-session stream mutate.
- 2026-04-18: Thêm `make test-e2e-ui-restore` để seed restore state, restart `core_trading`, verify backend restore, rồi chạy Playwright browser acceptance cho dashboard/session history sau restart.
- 2026-04-18: Chuyển `make typecheck-ui`, `make lint-ui`, và `make build-ui` sang Docker runner chung của FE để loại bỏ dependency Node trên host cho toàn bộ quality gates chính.
- 2026-04-17: Mở rộng smoke flow sang chuỗi `UI -> start session -> publish strategy signal -> publish price -> report/audit -> stop session`, đồng thời thêm smoke riêng cho Kafka path và restore path.
- 2026-04-17: Chốt `Docker-only` verification cho `lint-go`, `lint-py`, `test-go`, `test-py`, `smoke-paper`, `smoke-paper-kafka`, `smoke-restore`.
- 2026-04-20: Thêm local K8s runtime `kind + Helm` với chart đầy đủ cho stack, ingress NGINX một host, production Dockerfiles cho Go/Python, make targets `k8s-*`, và smoke script K8s qua same-origin UI entrypoint.
- 2026-04-20: Mở rộng K8s chart theo hướng product-like: persistence mặc định cho `Postgres/Kafka`, exposure modes `Ingress/NodePort/LoadBalancer`, `PDB`, `HPA` cho `data_pipeline`, bootstrap `metrics-server + MetalLB`, static PV demo cho Postgres, và scripts demo `hpa/rollout/exposure`.
- 2026-04-20: Thêm internal ops benchmark endpoints bên Python có token gate, đồng thời chặn browser proxy tới `/internal/ops*` ở Node runtime UI.
- 2026-04-20: Thêm `scripts/smoke-k8s-restore.sh`, make target `k8s-smoke-restore`, workflow `k8s-ci`, và hardening FE để shell/lab/dashboard surface degraded state từ `/core/health`, `/data/health`, và SSE; mocked Playwright đã cover các path degraded chính.
- 2026-04-21: Mở rộng simulation platform theo hướng `formula-first evaluation`: per-run `execution_profile`, persisted `metrics_snapshot`/`stopped_reason`, run filters `bot_id/bot_version/scenario_id`, và `GET /api/sim/leaderboard`.
- 2026-04-21: Mở rộng data pipeline với replay scenario catalog metadata và seed thêm scenarios `trend-up`, `flash-crash-recovery`, `range-chop` để benchmark bot rõ ngữ cảnh hơn.
- 2026-04-21: Bổ sung built-in bots `buy-and-hold:v1` và `moving-average-cross:v1`, đồng thời mở route `/leaderboard` trong UI để đọc ranking completed runs.
- 2026-04-21: Đóng wave `Batch Experiments v1`: thêm experiment APIs/routes, sequential coordinator + restore logic, aggregate summary, smoke experiment flow, và hard rule `leaderboard = completed standalone runs only`.

## 4. Next Recommended Slices

1. Mở rộng execution realism sau v1 sang venue-depth model rõ hơn: liquidity curve, queue priority, partial cancel/amend, và market-impact giả lập thay vì chỉ latency/spread/fill cap.
2. Mở rộng acceptance cho scenario-heavy matrices, failure injection, queue promotion, và restore path của `bot_runner`/`core_trading` với heartbeat loss cases.
3. Nếu cần scale batch lớn hơn, cân nhắc queue fairness/ownership policy rõ hơn cho coordinator trước khi nghĩ tới parallel child runs hay HPA cho `core_trading`.

## 5. Open Risks / Decisions

- `StateStore.SaveState` hiện xóa và ghi lại `paper_orders`, `paper_positions`, `market_prices`, và audit rows của current session để đồng bộ với session reset; cách này phù hợp local simulator v1 nhưng chưa tối ưu cho throughput cao.
- Session history đã được expose ở mức list + selected-session reads, nhưng chưa có paging sâu, sort options hay detail page riêng.
- Frontend đã lên nền `React + Vite + TypeScript`, và toàn bộ quality gates chính hiện chạy được qua Docker runner gồm typecheck, lint, build, vitest, mocked browser specs, live browser acceptance cho dashboard, sessions, historical isolation, lab, restore-after-restart, và mocked degraded upstream states; nhưng live degraded-path verify trên backend thật vẫn nên chạy thêm khi có thời gian.
- Leaderboard hiện là `completed standalone runs only`; aggregate theo bot/version/scenario đã nằm ở experiment detail, nhưng chưa có confidence window hay statistical significance layer.
- Local K8s runtime đã có CI workflow và smoke restore script, nhưng full GitHub run/kind verify cho path mới vẫn cần quan sát thêm ở môi trường CI thật.
- `core_trading` hiện là stateful singleton; chart cố ý chưa scale ngang service này. Nếu muốn HPA cho core phải tách session/runtime ownership trước.
- K8s addons/profile mới đã được lint/template pass, nhưng full end-to-end verify trên `kind` cho toàn bộ demo paths `HPA/NodePort/LoadBalancer` vẫn nên chạy lại khi có môi trường cluster sạch.
- `make lint-go` vẫn cài `golangci-lint` trong container mỗi lần chạy để giữ đúng Go toolchain; sạch cho host nhưng tốn thời gian hơn một chút.

## 6. Update Checklist

Sau mỗi task có ý nghĩa, cập nhật file này nếu có thay đổi về:

- trạng thái implementation
- lệnh chạy hoặc lệnh verify
- milestone đã xong
- blocker mới
- quyết định kiến trúc mới
