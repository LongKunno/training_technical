# Crypto Trading Simulator

Repo này đang đi theo hướng `simulator-first` và `formula-first bot evaluation`: ưu tiên `paper trading`, `market data mock/replay`, benchmark bot trên dữ liệu giả lập có thông số gần thật, và local dev sạch trước khi nghĩ tới trading thật. Local runtime chính hiện là `kind + Helm`; Docker Compose vẫn được giữ làm fallback và cho các quality gate/smoke flow hiện có.

## Snapshot hiện tại

- `services/core-trading-go`
  - paper trading engine với `fee/slippage`, `mark price`, `session lifecycle`, `signal contract`, `risk controls`, `audit trail`, `session report`
  - HTTP APIs cho `account`, `portfolio`, `positions`, `rules`, `orders`
  - simulation APIs cho `bot catalog`, `run queue`, `run detail`, `run stop`, `experiment list/detail/summary/stop`, và `leaderboard`
  - mỗi simulation run chụp lại `execution_profile_snapshot`, `market_profile_snapshot`, `metrics_snapshot`, và `stopped_reason` để history/compare ổn định
  - execution realism v1 đã dùng `market_profile_snapshot` để mô phỏng `signal latency`, `spread`, `per-tick fill cap`, và `split-fill`; runtime cũng persist `pending executions` để restore đúng sau restart
  - `/api/sim/leaderboard` giữ semantics `completed standalone runs only`; aggregate compare của batch chỉ nằm ở experiment detail
  - internal APIs cho `market price ingest` và `signals`
  - internal callback để `bot_runner` cập nhật trạng thái run và heartbeat; stale heartbeat sẽ fail run với reason `runner_lost`
  - Postgres state store v1 và Kafka consumer tùy chọn
- `services/data-pipeline-py`
  - mock market data service với `latest quote`, `publish latest`, `replay theo scenario/speed`
  - scenario catalog/dataset metadata cho replay selection và benchmark setup
  - read API cho raw replay ticks để bot runner dùng lại cùng scenario source
  - strategy mock service với `signal list`, `publish slice`, `replay scenario`
  - HTTP publish sang Go internal ingest
  - Kafka publish tùy chọn cho `PriceTickV1`
  - internal ops benchmark endpoints cho demo HPA nội bộ, khóa bằng token/env
- `services/bot-runner-py`
  - first-party execution service cho simulation bots
  - lấy replay ticks từ `data_pipeline`, publish market tick + signal vào `core_trading`, rồi callback trạng thái run về core
  - built-in seeded bots: `baseline-roundtrip:v1`, `buy-and-hold:v1`, `moving-average-cross:v1`
- `services/simulator-ui`
  - frontend product-grade `React + Vite + TypeScript` cho operator dashboard, session history/detail và lab controls
  - thêm workspace `/runs`, `/runs/:runId`, `/experiments`, `/experiments/:experimentId`, và `/leaderboard` cho bot evaluation
  - `/runs` là single-run workflow; `/experiments` là batch workflow; `/leaderboard` chỉ đọc completed standalone runs
  - Node runtime serve bundle và same-origin proxy sang Go/Python services qua `/core/*` và `/data/*`
  - shell, dashboard, và lab đã surface trực tiếp trạng thái `/core/health`, `/data/health`, và current-session SSE để operator thấy degraded state sớm
  - runtime chặn browser access tới `/core/internal/ops*` và `/data/internal/ops*`
  - Docker dev override cho Vite hot reload qua `docker-compose.ui-dev.yml`
  - Docker E2E runner riêng qua `docker-compose.ui-e2e.yml` cho `vitest` và `playwright`
- `docker-compose.yml`
  - `postgres`, `redis`, `kafka`, `migrations`, `core_trading`, `data_pipeline`, `bot_runner`, `simulator_ui`, `smoke_runner`
- `k8s/`
  - `kind/cluster.yaml` để dựng local cluster
  - `helm/crypto-simulator` để deploy toàn stack qua Helm với profiles `persistent`, `dev-ephemeral`, `ha`, `nodeport`, `loadbalancer`, `static-pv-demo`
  - chart hiện deploy cả `bot_runner` và migrations tới `0007` cho simulation bot/run/experiment evaluation, execution realism snapshot, và runner heartbeat
  - `infrastructure/` cho MetalLB và storage demo manifests
- Host ports mặc định
  - `core_trading` -> `http://localhost:18080`
  - `data_pipeline` -> `http://localhost:18000`
  - `simulator_ui` -> `http://localhost:18020`
  - K8s ingress -> `http://simulator.localtest.me:18020`

## Tài liệu nên đọc

- [Hướng dẫn vận hành cho AI](docs/ai-operating-guide.md)
- [Theo dõi tiến độ hiện tại](docs/progress-tracker.md)
- [Kiến trúc hệ thống chi tiết](docs/architecture.md)
- [Ánh xạ roadmap](docs/roadmap_mapping.md)
- [Rule Docker-only test](.antigravityrules)

## Khởi động nhanh

### K8s local runtime chính

Prerequisites:

- Docker
- `kind`
- `kubectl`
- `helm`
- `curl` và `jq` cho smoke script

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

`make k8s-kind-up` hiện bootstrap luôn `ingress-nginx`, `metrics-server`, và `MetalLB`.
Chart mặc định dùng `Ingress` + persistence cho `Postgres` và `Kafka`.
`core_trading` vẫn là singleton/stateful service; HPA chỉ được gắn cho `data_pipeline` ở profile HA.

Operator UI qua ingress:

```text
http://simulator.localtest.me:18020
```

Xem trạng thái K8s:

```bash
make k8s-status
```

Một số profile/demo K8s hữu ích:

```bash
make k8s-deploy K8S_VALUES_EXTRA='./k8s/helm/crypto-simulator/values-dev-ephemeral.yaml'
make k8s-deploy K8S_VALUES_EXTRA='./k8s/helm/crypto-simulator/values-ha.yaml'
make k8s-exposure-nodeport-demo
make k8s-exposure-lb-demo
make k8s-static-pv-demo
make k8s-hpa-demo-cpu
make k8s-hpa-demo-memory
make k8s-rollout-demo
```

NodePort demo mặc định map `http://localhost:18021`.
LoadBalancer demo dùng MetalLB cấp IP trong mạng `kind`.

### Docker Compose fallback

```bash
cp .env.example .env
make up
```

Chạy UI với Vite hot reload trong Docker:

```bash
cp .env.example .env
make up-ui-dev
```

Health checks:

```bash
curl http://localhost:18080/health
curl http://localhost:18000/health
curl http://localhost:18020/health
```

Operator UI Compose: `http://localhost:18020`

Frontend quality gates:

```bash
make typecheck-ui
make lint-ui
make test-ui
make build-ui
make test-e2e-ui
make test-e2e-ui-live
make test-e2e-ui-restore
```

Bot runner quality gates:

```bash
make test-bot-runner
make lint-bot-runner
```

`make up` dùng Node runtime production-like để serve bundle đã build. `make up-ui-dev` dùng cùng service `simulator_ui` nhưng override sang target `dev` và expose Vite trên cùng host port `18020`, nên hai flow này là thay thế nhau chứ không chạy song song.
`make typecheck-ui`, `make lint-ui`, `make build-ui`, `make test-ui`, `make test-e2e-ui`, `make test-e2e-ui-live`, và `make test-e2e-ui-restore` đều chạy trong Docker runner để không phụ thuộc Node trên host.
`make test-e2e-ui-live` tự dựng stack tạm, chạy Playwright live acceptance, rồi teardown bằng `trap` kể cả khi test fail.
`make test-e2e-ui-restore` dựng stack tạm, seed restore state, restart `core_trading`, verify backend restore, rồi chạy browser acceptance cho UI sau restart.

Smoke nhanh cho UI/proxy:

```bash
make smoke-ui-runtime
make smoke-ui-dev
make smoke-sim-run
make smoke-sim-experiment
make k8s-smoke
make k8s-smoke-restore
```

## API nhanh để thử tay

Session paper trading:

```bash
curl http://localhost:18080/api/paper/rules
curl http://localhost:18080/api/paper/session
curl 'http://localhost:18080/api/paper/sessions?limit=20&offset=0'
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
curl http://localhost:18000/api/data/market/quotes/replay/catalog
curl http://localhost:18000/api/data/market/quotes/replay/catalog/trend-up
curl 'http://localhost:18000/api/data/market/quotes/replay?scenario=baseline'
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
curl 'http://localhost:18080/api/paper/report?session_id=manual-session'
curl 'http://localhost:18080/api/paper/audit?session_id=manual-session&limit=20&offset=0'
curl 'http://localhost:18080/api/paper/timeline?session_id=manual-session'
```

Simulation runs và experiments:

```bash
curl http://localhost:18080/api/sim/bots
curl 'http://localhost:18080/api/sim/runs?limit=20&offset=0'
curl 'http://localhost:18080/api/sim/runs?experiment_id=sim-exp-123&limit=20&offset=0'
curl -X POST http://localhost:18080/api/sim/runs \
  -H 'Content-Type: application/json' \
  -d '{
    "bot_id":"buy-and-hold",
    "bot_version":"v1",
    "scenario_id":"trend-up",
    "bot_config":{"trade_notional":750,"tick_interval_ms":0},
    "execution_profile":{
      "initial_balance":15000,
      "fee_rate":0.0015,
      "slippage_rate":0.0025,
      "risk_controls":{
        "allowed_symbols":["BTCUSDT","ETHUSDT"],
        "max_position_quantity":5,
        "max_order_notional":5000,
        "max_daily_loss":2500,
        "cooldown_seconds":0,
        "max_open_notional":7000
      }
    }
  }'
curl http://localhost:18080/api/sim/runs/sim-run-123
curl -X POST http://localhost:18080/api/sim/runs/sim-run-123/stop
curl 'http://localhost:18080/api/sim/experiments?limit=20&offset=0'
curl http://localhost:18080/api/sim/experiments/sim-exp-123
curl http://localhost:18080/api/sim/experiments/sim-exp-123/summary
curl -X POST http://localhost:18080/api/sim/experiments \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"baseline-matrix",
    "bots":[
      {"bot_id":"buy-and-hold","bot_version":"v1"},
      {"bot_id":"moving-average-cross","bot_version":"v1","bot_config":{"trade_notional":500,"fast_window":2,"slow_window":4}}
    ],
    "scenarios":["trend-up","range-chop"],
    "repetitions":2,
    "execution_profile":{
      "initial_balance":15000,
      "fee_rate":0.0015,
      "slippage_rate":0.0025
    }
  }'
curl -X POST http://localhost:18080/api/sim/experiments/sim-exp-123/stop
curl 'http://localhost:18080/api/sim/leaderboard?limit=20&offset=0'
```

`microstructure_profile` từ catalog hiện đã đi vào execution realism v1 trong paper engine: `signal latency`, `spread`, `per-tick fill cap`, và `split-fill` ảnh hưởng trực tiếp tới order execution. `market_profile_snapshot` vẫn được persist trên run để replay/compare đúng context, còn venue-depth realism sâu hơn vẫn là wave sau.

## Verify trong Docker

Mọi loại test và smoke chỉ được chạy trong Docker.

```bash
make lint-go
make lint-py
make test-go
make test-py
make test-bot-runner
make test-ui
make test-e2e-ui
make test-e2e-ui-live
make test-e2e-ui-restore
make smoke-ui-runtime
make smoke-ui-dev
make smoke-paper
make smoke-paper-kafka
make smoke-restore
make smoke-sim-run
make smoke-sim-experiment
```

Verify local K8s runtime:

```bash
make k8s-kind-up
make k8s-build-images
make k8s-load-images
make k8s-deploy
make k8s-smoke
make k8s-smoke-restore
```

Optional K8s demos:

```bash
make k8s-hpa-demo-cpu
make k8s-hpa-demo-memory
make k8s-rollout-demo
make k8s-exposure-nodeport-demo
make k8s-exposure-lb-demo
make k8s-static-pv-demo
```

Smoke flow hiện tại verify chuỗi:

```text
UI entrypoint -> start session A -> publish strategy signal -> publish mock price -> portfolio -> sell signal -> report/audit/timeline -> stop A -> start B -> sessions/history lookup -> session-scoped reads -> stop B
```

Smoke `make smoke-sim-run` verify chuỗi:

```text
UI/core/data/bot-runner healthy -> list bots -> create simulation run -> wait completed -> list runs -> read report/audit/timeline by run session
```

Smoke `make smoke-sim-experiment` verify chuỗi:

```text
UI/core/data/bot-runner healthy -> create standalone run -> wait completed -> create experiment -> wait terminal -> read experiment detail -> read summary -> list child runs by experiment_id -> read child run detail + report/audit/timeline -> verify leaderboard vẫn chỉ giữ standalone runs
```

Live UI acceptance hiện verify thêm:

```text
/dashboard current-session load -> /sessions immutable historical detail -> historical detail không bị mutate bởi current-session stream -> /lab operator actions
```

Restore UI acceptance verify chuỗi:

```text
prepare restore session -> restart core_trading -> backend restore verify -> /dashboard render current restored state -> /sessions historical detail vẫn đọc được sau restart
```

## Cleanup

```bash
make clean-docker
make clean-docker-all
make down-ui-dev
make k8s-kind-down
```

`make clean-docker-all` sẽ xóa cả named volumes của compose, gồm dữ liệu local của Postgres và Kafka trong stack này.
