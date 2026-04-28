# Project Context

Tạo lúc: 2026-04-28 15:54:33 +07

## Luật cứng

- Luôn giao tiếp với người dùng bằng tiếng Việt.
- Không commit hoặc push nếu người dùng chưa yêu cầu trực tiếp.
- Tri thức dự án dùng chung nằm trong `_bmad-output/`; không dùng `docs/` nữa.
- Khi source code khác artifact BMad, ưu tiên source code và cập nhật artifact BMad.
- Repo vẫn là paper-trading simulator; không thêm real exchange trading, API key thật, hoặc secret thật.
- Mọi quality gate/test/benchmark dùng để verify logic phải chạy trong Docker containers theo `.antigravityrules`; không chạy host `go test`, `pytest`, hoặc command test tương đương trên host.

## Snapshot sản phẩm

`crypto-trading-simulator` là monorepo cho crypto paper-trading simulator và formula-first bot evaluation. Mục tiêu hiện tại là benchmark bot trên mock/replay data, execution profile, fee/slippage, risk controls, audit/report/timeline và local K8s runtime. Chưa có trading thật.

## Services

- `services/core-trading-go`: Go paper-trading engine và simulation coordinator. Own runtime truth cho session, orders, positions, audit, report, timeline, runs, experiments, leaderboard, heartbeat reconciliation và Postgres restore.
- `services/data-pipeline-py`: FastAPI mock market/strategy data service. Own replay fixtures, scenario catalog, microstructure profile, HTTP/Kafka tick publish, signal publish/replay và internal ops benchmark endpoints.
- `services/bot-runner-py`: FastAPI internal runner service. Chạy deterministic built-in bots, đọc replay ticks từ data pipeline, publish market ticks/signals vào core và callback status/heartbeat về core.
- `services/simulator-ui`: React + Vite + TypeScript operator UI. Node runtime serve built bundle và proxy same-origin sang core/data; chỉ expose `/bot/health` cho bot runner.

## Runtime hiện tại

- Runtime local chính: `kind + Helm` qua `make k8s-*`.
- Compose fallback: `make up`, `make up-ui-dev`, smoke và UI Docker gates.
- Public local ports: core `18080`, data `18000`, UI `18020`.
- K8s ingress: `http://simulator.localtest.me:18020`.
- NodePort demo: `http://localhost:18021`.

## Ranh giới kiến trúc

- `core_trading` hiện là stateful singleton. Không scale ngang service này cho tới khi có ownership partition, distributed lease/fencing, idempotent reconciliation và queue fairness model.
- `data_pipeline` là stateless workload đầu tiên dùng cho HPA/demo scaling.
- `Kafka` là transport cho `PriceTickV1`, không phải source of truth.
- `Redis` chưa là state tier chính; chỉ coi là ephemeral/cache cho đến khi có feature định nghĩa ownership/restore rõ ràng.
- Browser không được gọi internal endpoints. UI runtime/proxy chặn `/core/internal/ops*`, `/data/internal/ops*` và không expose `/bot/internal/*`.

## Ghi nhớ cho agent

- Đọc source router/contracts trước khi sửa UI/API.
- Core API dùng error envelope `{"error":{"code":"...","message":"..."}}`; nhiều command endpoint dùng `DisallowUnknownFields`.
- FastAPI schemas dùng Pydantic và nhiều schema có `extra="forbid"`.
- `POST /api/paper/orders` chưa retry-safe nếu duplicate body; automated retry nên dùng `/internal/signals` với stable `signal_id`.
- `/api/sim/leaderboard` chỉ gồm completed standalone runs; experiment child runs compare trong experiment detail/summary.
- Simulation run snapshots gồm `config_snapshot`, `execution_profile_snapshot`, `market_profile_snapshot`, `metrics_snapshot` và `stopped_reason`.
- Migrations hiện tại đến `0009_add_order_session_scope`.
- Structured request/lifecycle logging đã có trong core, data pipeline, bot runner và UI runtime.

## Verification mapping

- Core Go: `make test-go`, `make lint-go`
- Data pipeline: `make test-py`, `make lint-py`
- Bot runner: `make test-bot-runner`, `make lint-bot-runner`
- UI: `make typecheck-ui`, `make lint-ui`, `make test-ui`, `make build-ui`, `make test-e2e-ui`
- Paper flow: `make smoke-paper`; Kafka path: `make smoke-paper-kafka`
- Restore: `make smoke-restore`; UI restore path: `make test-e2e-ui-restore`
- Simulation: `make smoke-sim-run`, `make smoke-sim-experiment`
- K8s/Helm: `make k8s-lint`, `make k8s-template`, `make k8s-smoke`, `make k8s-smoke-restore`
