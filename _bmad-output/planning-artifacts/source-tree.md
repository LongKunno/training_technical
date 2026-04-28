# Source Tree

Tạo lúc: 2026-04-28 15:54:33 +07

## Root

```text
.
├── .agents/                         # BMad/Codex skills dùng chung cho team
├── _bmad/                           # BMad installation/config/manifest/scripts
├── _bmad-output/                    # Project knowledge, planning, implementation, test artifacts
├── .github/workflows/               # CI workflows
├── k8s/                             # kind config, Helm chart, local infra manifests
├── scripts/                         # smoke, K8s demo, test runner scripts
├── services/
│   ├── core-trading-go/
│   ├── data-pipeline-py/
│   ├── bot-runner-py/
│   └── simulator-ui/
├── docker-compose.yml
├── docker-compose.ui-dev.yml
├── docker-compose.ui-e2e.yml
├── Makefile
└── README.md
```

## Core Trading Go

```text
services/core-trading-go/
├── cmd/api/main.go
├── internal/
│   ├── config/
│   ├── handlers/
│   ├── marketdata/
│   ├── papertrading/
│   ├── server/
│   ├── simulation/
│   └── storage/postgres/
└── migrations/
```

File quan trọng:

- `internal/server/router.go`: đăng ký route HTTP.
- `internal/server/structured_logging.go`: request id và structured request logging.
- `internal/handlers/papertrading.go`: paper API và internal market/signal handlers.
- `internal/handlers/simulation.go`: bot/run/experiment/leaderboard handlers và status/heartbeat callbacks.
- `internal/papertrading/service.go`: behavior của paper engine.
- `internal/papertrading/runtime.go`: execution/fill runtime behavior.
- `internal/simulation/service.go`: run/experiment coordinator và restore/reconcile behavior.
- `internal/storage/postgres/state_store.go`: durable state store.
- `migrations/0001` đến `0009`: schema và index history.

## Data Pipeline Python

```text
services/data-pipeline-py/
├── app/
│   ├── api/routes/
│   ├── core/
│   ├── fixtures/
│   ├── schemas/
│   └── services/
├── tests/
├── Dockerfile
├── Dockerfile.dev
├── pytest.ini
├── requirements.txt
└── ruff.toml
```

File quan trọng:

- `app/api/routes/market.py`: market quote/replay/catalog/publish endpoints.
- `app/api/routes/strategy.py`: strategy signal endpoints.
- `app/api/routes/ops.py`: protected CPU/memory benchmark endpoints.
- `app/core/structured_logging.py`: request logging middleware.
- `app/services/market_data.py`: scenario catalog và replay tick loading.
- `app/services/publisher.py`: HTTP/Kafka tick publishing.
- `app/services/signal_publisher.py`: signal publish sang Core.

## Bot Runner Python

```text
services/bot-runner-py/
├── app/
│   ├── api/routes/
│   ├── core/
│   ├── schemas/
│   └── services/
├── tests/
├── Dockerfile
├── Dockerfile.dev
└── requirements.txt
```

File quan trọng:

- `app/api/routes/runs.py`: internal start/stop endpoints.
- `app/services/runner_service.py`: bot execution loops, validation, publish retry, status/heartbeat callbacks.
- `app/schemas/runner.py`: `StartRunRequest` và replay tick schema.

## Simulator UI

```text
services/simulator-ui/
├── server/index.js
├── src/
│   ├── app/
│   ├── features/
│   └── shared/
├── playwright/
├── Dockerfile
├── Dockerfile.e2e
├── package.json
├── vite.config.ts
└── vitest.config.ts
```

File quan trọng:

- `server/index.js`: Node runtime, health, proxy, security blockers, structured logs.
- `src/app/router.tsx`: operator route map.
- `src/shared/api/`: typed clients cho core, data, sim và bot health.
- `src/shared/types/`: API contract types.
- `src/shared/ui/`: common UI primitives.
- `playwright/*.spec.ts`: route-level UI acceptance coverage.

## K8s

```text
k8s/
├── kind/cluster.yaml
├── helm/crypto-simulator/
│   ├── templates/
│   ├── files/migrations/
│   ├── values.yaml
│   ├── values-dev-ephemeral.yaml
│   ├── values-ha.yaml
│   ├── values-exposure-nodeport.yaml
│   ├── values-exposure-lb.yaml
│   └── values-static-pv-demo.yaml
└── infrastructure/
```

Helm chart gồm migrations, services, deployments, config/secret, persistence, HPA/PDB templates, resources, probes và local exposure profiles.
