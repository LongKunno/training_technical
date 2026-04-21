# AI Operating Guide

Đây là entry point ngắn gọn để AI đọc đúng trạng thái repo `crypto-trading-simulator` trước khi làm việc.

## 1. Mục tiêu

- Giúp AI hiểu `implementation hiện tại`, không nhầm với `kiến trúc mục tiêu`.
- Giữ cho mỗi lượt làm việc bám sát source code, tiến độ thật và rule test trong Docker.
- Giảm việc phải nhắc lại context ở mỗi phiên.

## 2. Tài liệu nên đọc trước khi code

1. `README.md`
2. `docs/progress-tracker.md`
3. `docs/ai-operating-guide.md`
4. `.antigravityrules`
5. `docs/architecture.md`
6. `docs/roadmap_mapping.md`

## 3. Những gì đúng ở thời điểm hiện tại

- Repo đang theo hướng `simulator-first`, chưa có real trading.
- Go service là lõi paper trading hiện tại, đã có:
  - account, portfolio, positions, rules, orders APIs
  - session lifecycle APIs
  - audit/report APIs
  - internal market ingest API
  - internal signal API
  - fee/slippage rules
  - risk controls
  - mark price state
  - Postgres persistence cho:
    - account state
    - order history
    - latest positions
    - latest market prices
    - session runtime
    - audit events
    - report snapshot
    - processed signal ids
  - restore state sau restart cho session, audit và report
  - Kafka consumer tùy chọn cho `PriceTickV1`
- Python service đang đóng vai trò mock market data và strategy mock service, đã có:
  - latest quote endpoint theo scenario
  - publish latest quotes
  - replay quotes theo scenario và speed
  - strategy signal scenarios
  - strategy signal list
  - publish slice signals
  - replay signals theo scenario
  - fixture JSON loader
  - HTTP publish sang Go
  - Kafka publish tùy chọn cho market data
  - internal ops benchmark endpoints cho local HPA demo, khóa bằng `OPS_BENCHMARK_ENABLED` và `OPS_BENCHMARK_TOKEN`
- Dashboard nội bộ `services/simulator-ui` đã có:
  - frontend thật `React + Vite + TypeScript`
  - Node runtime serve bundle production và proxy `/core/*`, `/data/*`
  - `GET /health` cho runtime UI
  - shell/lab/dashboard surface trực tiếp trạng thái `/core/health`, `/data/health`, và current-session SSE để degrade rõ ràng khi upstream có vấn đề
  - runtime UI chặn browser access tới `/core/internal/ops*` và `/data/internal/ops*`
  - override compose riêng `docker-compose.ui-dev.yml` để chạy Vite hot reload trên port `18020`
  - override compose riêng `docker-compose.ui-e2e.yml` để chạy `ui_e2e_runner` cho `vitest` và `playwright` trong Docker
  - session controls, market replay, strategy publish/replay, portfolio/report/rules snapshots, orders, positions, audit feed
- Repo đã có local K8s runtime:
  - `k8s/kind/cluster.yaml`
  - `k8s/helm/crypto-simulator`
  - `scripts/k8s-bootstrap-addons.sh` bootstrap `ingress-nginx`, `metrics-server`, `MetalLB`
  - `scripts/smoke-k8s.sh` và `scripts/smoke-k8s-restore.sh` cho happy path và restore-after-restart qua same-origin UI entrypoint
  - ingress một host `simulator.localtest.me:18020`
  - NodePort demo qua `localhost:18021`
  - chart profiles cho `dev-ephemeral`, `ha`, `nodeport`, `loadbalancer`, `static-pv-demo`
  - same-origin model giữ nguyên: browser -> `simulator_ui` -> `/core/*` và `/data/*`
- Quyết định kiến trúc K8s hiện tại:
  - `data_pipeline` là workload stateless để HPA trước
  - `core_trading` vẫn singleton/stateful, không scale ngang bừa bãi
- Docker Compose hiện có `postgres`, `redis`, `kafka`, `migrations`, `core_trading`, `data_pipeline`, `simulator_ui`, `smoke_runner`.
- App host ports mặc định hiện là:
  - `core_trading` -> `18080`
  - `data_pipeline` -> `18000`
  - `simulator_ui` -> `18020`
- Infra services không expose port ra host mặc định.

## 4. Cách làm việc mặc định cho AI

- Đọc `docs/progress-tracker.md` trước khi nhận định về trạng thái repo.
- Khi docs khác source code, tin source code rồi cập nhật lại docs.
- Giữ thay đổi nhỏ, theo lát cắt dọc, hoàn thành trọn gói nếu có thể:
  - code
  - verify trong Docker
  - docs/tracker liên quan
- Với runtime local/integration mới, ưu tiên `make k8s-*`; với quality gates hiện có của repo, vẫn ưu tiên verify trong Docker.
- Không tự mở rộng phạm vi sang trading thật; repo hiện vẫn là paper trading simulator.
- Rule repo bắt buộc cần nhớ: mọi quality gate FE chính và mọi loại test đều phải ưu tiên chạy trong Docker.

## 5. Commands tham khảo

### Đọc repo

```bash
rg --files
git status --short
```

### Chạy local

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

### K8s demos

```bash
make k8s-hpa-demo-cpu
make k8s-hpa-demo-memory
make k8s-rollout-demo
make k8s-exposure-nodeport-demo
make k8s-exposure-lb-demo
make k8s-static-pv-demo
```

### Chạy local bằng Docker Compose fallback

```bash
cp .env.example .env
make up
```

### Chạy UI dev bằng Vite trong Docker

```bash
cp .env.example .env
make up-ui-dev
```

### Health check

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

### K8s status

```bash
make k8s-status
make k8s-kind-down
```

### Verify trong Docker

```bash
make lint-go
make lint-py
make test-go
make test-py
make test-ui
make test-e2e-ui
make test-e2e-ui-live
make test-e2e-ui-restore
make smoke-ui-runtime
make smoke-ui-dev
make smoke-paper
make smoke-paper-kafka
make smoke-restore
```

### Cleanup

```bash
make clean-docker
make clean-docker-all
```

`make test-e2e-ui-live` và `make test-e2e-ui-restore` tự quản lifecycle của compose stack: dựng stack tạm, chạy live Playwright, rồi teardown tự động kể cả khi gặp lỗi.

## 6. Khi nào phải cập nhật progress tracker

Cập nhật `docs/progress-tracker.md` nếu task làm thay đổi một trong các phần sau:

- trạng thái implementation
- lệnh chạy hoặc lệnh verify
- milestone đã xong
- blocker mới
- quyết định kiến trúc mới
