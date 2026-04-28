# Progress Tracker

Tạo lúc: 2026-04-28 15:54:33 +07

## Snapshot hiện tại

Dự án là multi-service paper-trading simulator và bot evaluation lab. Knowledge base dùng chung đã chuyển từ `docs/` sang `_bmad-output/`; không nên tạo lại `docs/`.

## Năng lực đã có

### Core Trading Go

- Paper APIs cho account, portfolio, positions, rules, current session, session history, orders, audit, report, timeline và timeline SSE.
- Session lifecycle commands: start, reset, stop.
- Manual market orders và internal `SignalV1` execution.
- Risk controls: allowed symbols, max position quantity, max order notional, max daily loss, cooldown, max open notional.
- Execution realism fields: signal latency, spread, max fill notional per tick, liquidity curve, queue priority, market impact, cancel-after-ticks.
- Pending execution persistence và restore.
- Simulation APIs cho bot catalog, runs, experiments, leaderboard, run stop, experiment stop, experiment summary.
- Runner callbacks cho status và heartbeat.
- Heartbeat stale handling với `runner_lost`.
- Structured request logging.
- Postgres migrations tới `0009_add_order_session_scope`.
- Query indexes cho sessions, active runs, leaderboard, queued experiments và session-scoped orders.

### Data Pipeline Python

- Market latest quote, replay list, scenarios, catalog, scenario detail, publish latest và replay publish.
- Strategy scenarios, signal list, publish và replay.
- Scenario metadata cho `baseline`, `trend-up`, `flash-crash-recovery`, `range-chop`, `volatility-spike`.
- HTTP publish sang Core và optional Kafka publish cho market ticks.
- Internal CPU/memory benchmark endpoints gated bằng env/token.
- Structured request logging.

### Bot Runner Python

- Internal start/stop run endpoints.
- Deterministic built-in bots:
  - `baseline-roundtrip:v1`
  - `buy-and-hold:v1`
  - `moving-average-cross:v1`
- Replay tick load từ data pipeline.
- Bot config validation.
- Tick ordering validation theo `(timestamp, symbol)`.
- Signal envelope validation.
- Retry khi Core transport errors và `5xx`.
- Status và heartbeat callbacks sang Core.
- Structured lifecycle logs.

### Simulator UI

- Routes: dashboard, sessions, session detail, lab, runs, run detail, experiments, experiment detail, leaderboard.
- Node runtime health endpoint, same-origin `/core/*` và `/data/*` proxies, health-only `/bot/health`.
- Browser blockers cho `/core/internal/ops*`, `/data/internal/ops*` và non-health bot internals.
- Shared API/query/types/state/UI layers.
- ECharts chart helpers và reusable UI primitives.
- Playwright coverage cho dashboard, lab, sessions, runs, experiments, leaderboard, live và restore flows.

### Runtime Và Infrastructure

- Docker Compose stack: postgres, redis, kafka, migrations, core, data, bot runner, UI, smoke runner.
- Compose Vite dev override và UI E2E runner override.
- Helm chart cho local K8s với persistence, ingress, NodePort/LoadBalancer profiles, HPA/PDB templates, resources, probes, config/secret, migration files.
- kind cluster config và K8s smoke/demo scripts.

## Verification đã được tracker cũ ghi nhận

Các command sau từng được ghi nhận pass trong Docker/local runtime:

- `make lint-go`
- `make lint-py`
- `make test-go`
- `make test-py`
- `make test-bot-runner`
- `make typecheck-ui`
- `make lint-ui`
- `make test-ui`
- `make build-ui`
- `make test-e2e-ui`
- `make test-e2e-ui-live`
- `make smoke-paper`
- `make smoke-paper-kafka`
- `make smoke-restore`
- `make smoke-sim-run`
- `make smoke-sim-experiment`
- Helm lint/template cho main, HA, NodePort, LoadBalancer, static PV profiles
- Docker builds cho core, data pipeline, bot runner, simulator UI
- `make k8s-deploy`
- `make k8s-smoke`

Lượt migration BMad này chưa chạy lại test vì chỉ đổi tổ chức documentation/config và xoá legacy docs.

## Việc còn mở

- Chạy lại selected gates khi dirty worktree hiện tại sẵn sàng để validate.
- Cập nhật `_bmad-output` thay vì `docs/`.
- Rà các reference cũ tới `docs/` trong prose và đổi sang `_bmad-output/` khi chạm file liên quan.
- Tiếp tục làm rõ terminal reasons và UI surfacing cho failed/stopped runs.
- Thiết kế state ownership trước khi scale `core_trading`.
