# Verification Matrix

Tạo lúc: 2026-04-28 15:54:33 +07

Tất cả command dưới đây chạy trong Docker/container. Không chạy host `go test`, host `pytest`, hoặc test command tương đương trên host để verify dự án.

| Vùng thay đổi | Command tối thiểu |
| --- | --- |
| Core trading Go API/runtime/persistence | `make test-go`, `make lint-go` |
| Data pipeline fixtures/publish/catalog | `make test-py`, `make lint-py` |
| Bot runner lifecycle/bot logic | `make test-bot-runner`, `make lint-bot-runner` |
| Simulator UI code/contracts | `make typecheck-ui`, `make lint-ui`, `make test-ui`, `make build-ui`, `make test-e2e-ui` |
| Paper trading integration | `make smoke-paper` |
| Kafka market tick path | `make smoke-paper-kafka` |
| Restore/session persistence | `make smoke-restore` |
| UI restore behavior | `make test-e2e-ui-restore` |
| Simulation single run | `make smoke-sim-run` |
| Simulation experiment | `make smoke-sim-experiment` |
| UI runtime proxy/security boundary | `make smoke-ui-runtime`, `make smoke-ui-dev` |
| Helm/K8s manifests/values | `make k8s-lint`, `make k8s-template` |
| Full K8s smoke | `make k8s-smoke`, `make k8s-smoke-restore` |

## Checklist debug smoke fail

1. Kiểm tra services: `docker compose ps`.
2. Đọc logs theo flow: `docker compose logs --tail=200 core_trading data_pipeline bot_runner simulator_ui`.
3. Check same-origin UI health trước: `/health`, `/core/health`, `/data/health`, `/bot/health` qua `http://localhost:18020`.
4. Nếu lỗi simulation, query state gần nhất từ Core: `/api/sim/runs?limit=5&offset=0`, `/api/sim/experiments?limit=5&offset=0`.
5. Nếu lỗi proxy/security, verify các browser paths bị chặn trả `404`: `/bot/internal/runs/start`, `/core/internal/ops/benchmark/cpu`, `/data/internal/ops/benchmark/cpu`.
6. Nếu có `SMOKE_ARTIFACT_DIR`, đọc artifact JSON trước khi rerun.
