# Tổng quan dự án

Tạo lúc: 2026-04-28 15:54:33 +07

## Mục tiêu

Xây dựng crypto paper-trading simulator chạy local trước, phục vụ đánh giá deterministic formula bots trên replay/mock market scenarios trước khi nghĩ tới real trading.

## Năng lực hiện có

- Paper account, portfolio, positions, rules, orders, session lifecycle, audit, report, timeline và SSE timeline stream.
- Market replay với scenario có tên và microstructure profile.
- Strategy signal fixtures và endpoint publish/replay.
- Simulation runs, experiments, queueing, stop flow, heartbeat reconciliation, metrics snapshots và standalone leaderboard.
- Built-in bots: `baseline-roundtrip:v1`, `buy-and-hold:v1`, `moving-average-cross:v1`.
- Operator UI cho dashboard, lab, sessions, runs, experiments và leaderboard.
- Docker Compose fallback và local K8s runtime với Helm profiles.

## Services hiện tại

| Service | Runtime | Vai trò |
| --- | --- | --- |
| `core_trading` | Go | Stateful paper engine, simulation coordinator, persistence owner |
| `data_pipeline` | Python/FastAPI | Mock/replay market data, strategy signals, scenario catalog, ops benchmark |
| `bot_runner` | Python/FastAPI | Internal deterministic formula bot executor |
| `simulator_ui` | React/Vite + Node | Operator console và same-origin proxy |
| `postgres` | Postgres 15 | Durable state cho paper/session/simulation |
| `kafka` | Apache Kafka 3.9 | Optional market tick transport |
| `redis` | Redis 7 | Ephemeral/cache tier hiện tại |

## Semantics sản phẩm quan trọng

- `runs` là single simulation workflow.
- `experiments` expand `bots x scenarios x repetitions` và chạy child runs tuần tự dưới singleton boundary của Core.
- `leaderboard` chỉ rank completed standalone runs.
- Experiment aggregate comparison nằm trong experiment detail/summary.
- Execution realism gồm latency, spread, per-tick fill cap, split fill, liquidity curve, queue priority, market impact và cancel-after-ticks.

## Entry points local

- Compose UI: `http://localhost:18020`
- Core direct: `http://localhost:18080`
- Data direct: `http://localhost:18000`
- K8s ingress: `http://simulator.localtest.me:18020`
- NodePort demo: `http://localhost:18021`
