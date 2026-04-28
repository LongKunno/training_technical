# API Contracts

Tạo lúc: 2026-04-28 15:54:33 +07

## Quy ước chung

- Core errors dùng `{"error":{"code":"...","message":"..."}}`.
- Core command endpoints reject unknown JSON fields bằng `DisallowUnknownFields`.
- FastAPI/Pydantic endpoints thường dùng `extra="forbid"` và trả lỗi validation chuẩn FastAPI.
- Timestamp nên là UTC JSON datetime, ví dụ `2026-04-25T00:00:00Z`.
- Pagination defaults/max:
  - `GET /api/paper/orders`: default `50`, max `200`
  - `GET /api/paper/sessions`: default `20`, max `100`
  - `GET /api/paper/audit`: default `100`, max `500`
  - simulation lists/leaderboard: default `20`, max `100`

## Core Trading Public Paper API

Base Compose URL: `http://localhost:18080`

| Method | Path | Response wrapper | Ghi chú |
| --- | --- | --- | --- |
| `GET` | `/health` | health object | Liveness check |
| `GET` | `/api/paper/account` | `{account}` | Raw virtual account |
| `GET` | `/api/paper/portfolio` | `{portfolio}` | Mark-to-market summary |
| `GET` | `/api/paper/positions` | `{positions}` | Position summaries |
| `GET` | `/api/paper/rules` | `{rules}` | Initial balance, fee/slippage, risk controls |
| `GET` | `/api/paper/session` | `{session}` | Current session |
| `GET` | `/api/paper/sessions` | `{sessions}` | Query `q`, `status`, `limit`, `offset` |
| `POST` | `/api/paper/session/start` | `{session}` | Body optional `{session_id}`, status `201` |
| `POST` | `/api/paper/session/reset` | `{session}` | Reset runtime |
| `POST` | `/api/paper/session/stop` | `{session}` | Stop current session |
| `GET` | `/api/paper/orders` | `{orders}` | Query `session_id`, `symbol`, `side`, `limit`, `offset` |
| `POST` | `/api/paper/orders` | `{order, account}` | Manual market order |
| `GET` | `/api/paper/audit` | `{events}` | Query `session_id`, `limit`, `offset` |
| `GET` | `/api/paper/report` | `{report}` | Query `session_id` |
| `GET` | `/api/paper/timeline` | `{timeline}` | Query `session_id` |
| `GET` | `/api/paper/timeline/stream` | SSE | Emits `event: timeline` |

Manual order body:

```json
{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}
```

Lưu ý retry: `POST /api/paper/orders` chưa retry-safe nếu không có client idempotency key. Automated retry nên dùng `/internal/signals` với stable `signal_id`.

## Core Trading Simulation API

| Method | Path | Response wrapper | Ghi chú |
| --- | --- | --- | --- |
| `GET` | `/api/sim/bots` | `{bots}` | Bot catalog |
| `GET` | `/api/sim/bots/{botID}` | `{bot}` | Versions và config schema |
| `GET` | `/api/sim/runs` | `{runs}` | Query `q`, `status`, `bot_id`, `bot_version`, `scenario_id`, `experiment_id`, `limit`, `offset` |
| `POST` | `/api/sim/runs` | `{run}` | Tạo standalone run |
| `GET` | `/api/sim/runs/{runID}` | `{run}` | Run detail |
| `POST` | `/api/sim/runs/{runID}/stop` | `{run}` | Stop run |
| `GET` | `/api/sim/leaderboard` | `{rows}` | Completed standalone runs only |
| `GET` | `/api/sim/experiments` | `{experiments}` | Query `q`, `status`, `limit`, `offset` |
| `POST` | `/api/sim/experiments` | `{experiment}` | Tạo batch matrix |
| `GET` | `/api/sim/experiments/{experimentID}` | `{experiment}` | Detail với slots/child runs |
| `GET` | `/api/sim/experiments/{experimentID}/summary` | `{rows}` | Aggregate theo bot/version/scenario |
| `POST` | `/api/sim/experiments/{experimentID}/stop` | `{experiment}` | Stop queued/running experiment |

Run statuses: `starting`, `running`, `completed`, `stopped`, `failed`.

Experiment statuses: `queued`, `starting`, `running`, `completed`, `stopped`, `failed`.

Terminal reasons hiện gồm `completed`, `stopped`, `failed`, `runner_lost`.

Create run body:

```json
{
  "bot_id": "buy-and-hold",
  "bot_version": "v1",
  "scenario_id": "trend-up",
  "bot_config": {"trade_notional": 750, "tick_interval_ms": 0},
  "execution_profile": {
    "initial_balance": 15000,
    "fee_rate": 0.0015,
    "slippage_rate": 0.0025
  }
}
```

Compatibility: `config` vẫn được nhận như legacy alias cho `bot_config`.

Create experiment body:

```json
{
  "name": "baseline-matrix",
  "bots": [
    {"bot_id": "buy-and-hold", "bot_version": "v1"},
    {"bot_id": "moving-average-cross", "bot_version": "v1", "bot_config": {"fast_window": 2, "slow_window": 4}}
  ],
  "scenarios": ["trend-up", "range-chop"],
  "repetitions": 2,
  "execution_profile": {"initial_balance": 15000}
}
```

## Core Internal API

Browser UI không được gọi trực tiếp các endpoint này.

| Method | Path | Producer | Mục đích |
| --- | --- | --- | --- |
| `POST` | `/internal/market/prices` | data pipeline, bot runner | Ingest `PriceTickV1` |
| `POST` | `/internal/signals` | data pipeline, bot runner, lab/manual signal | Ingest `SignalV1` |
| `POST` | `/internal/sim/runs/{runID}/status` | bot runner | Status callback |
| `POST` | `/internal/sim/runs/{runID}/heartbeat` | bot runner | Heartbeat callback |

`PriceTickV1` fields: `symbol`, `price`, `source`, `timestamp`.

`SignalV1` fields: `strategy_id`, `signal_id`, optional `run_id`, optional `bot_id`, optional `bot_version`, `symbol`, `side`, `quantity`, `notional`, `price_hint`, `timestamp`.

## Data Pipeline API

Base Compose URL: `http://localhost:18000`

| Method | Path | Ghi chú |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Fixture/catalog readiness |
| `GET` | `/api/data/market/quotes/latest` | Query `symbol`, optional `scenario` |
| `GET` | `/api/data/market/quotes/replay` | Query `scenario`, repeated `symbol` |
| `GET` | `/api/data/market/quotes/replay/scenarios` | Scenario ids |
| `GET` | `/api/data/market/quotes/replay/catalog` | Scenario metadata |
| `GET` | `/api/data/market/quotes/replay/catalog/{scenario_id}` | Scenario detail |
| `POST` | `/api/data/market/quotes/publish` | Body `scenario`, `symbols`, `transport=http|kafka|both` |
| `POST` | `/api/data/market/quotes/replay` | Body `scenario`, `symbols`, `speed_multiplier`, `transport` |
| `GET` | `/api/data/strategy/signals/scenarios` | Signal scenario ids |
| `GET` | `/api/data/strategy/signals` | Query `scenario`, `strategy_id`, `limit`, `offset` |
| `POST` | `/api/data/strategy/signals/publish` | Publish selected signals |
| `POST` | `/api/data/strategy/signals/replay` | Replay signals |
| `POST` | `/internal/ops/benchmark/cpu` | Token gated |
| `POST` | `/internal/ops/benchmark/memory` | Token gated |

Known market scenarios: `baseline`, `trend-up`, `flash-crash-recovery`, `range-chop`, `volatility-spike`.

## Bot Runner Internal API

Base internal URL: `http://bot_runner:8001`

| Method | Path | Ghi chú |
| --- | --- | --- |
| `GET` | `/health` | Health only exposed by UI proxy as `/bot/health` |
| `POST` | `/internal/runs/start` | Start deterministic bot task, returns `202` |
| `POST` | `/internal/runs/{run_id}/stop` | Request local stop |

Start body:

```json
{
  "run_id": "sim-run-1",
  "bot_id": "buy-and-hold",
  "bot_version": "v1",
  "scenario_id": "trend-up",
  "session_id": "session-1",
  "config": {"trade_notional": 1000, "tick_interval_ms": 0},
  "started_at": "2026-04-25T00:00:00Z"
}
```
