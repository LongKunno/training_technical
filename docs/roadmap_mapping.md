# Roadmap Mapping

File này ánh xạ các chủ đề bạn muốn học vào đúng phần implementation hiện có của dự án, thay vì tách ra thành lab rời.

## 1. K8s Architecture & Setup

- `kind` cluster config: `k8s/kind/cluster.yaml`
- Helm app chart: `k8s/helm/crypto-simulator`
- Bootstrap local addons:
  - `scripts/k8s-bootstrap-addons.sh`
  - `scripts/k8s-bootstrap-metallb.sh`
- Command chính:

```bash
make k8s-kind-up
make k8s-build-images
make k8s-load-images
make k8s-deploy
```

## 2. Pods, ReplicaSets, Deployments, Healthchecks

- Deployments nằm trong `k8s/helm/crypto-simulator/templates/*deployment.yaml`
- Probes đã có cho:
  - `postgres`
  - `kafka`
  - `core-trading`
  - `data-pipeline`
  - `simulator-ui`
- Requests/limits đã có sẵn trong `values.yaml`
- Rollout settings và `PodDisruptionBudget` đã được model hóa trong chart
- HPA đang áp dụng cho `data_pipeline`, không áp dụng cho `core_trading`

Demo commands:

```bash
make k8s-hpa-demo-cpu
make k8s-hpa-demo-memory
make k8s-rollout-demo
```

## 3. Networking & Services

- Internal service-to-service traffic dùng `ClusterIP`
- Public exposure mặc định dùng `Ingress`
- Optional exposure modes:
  - `values-exposure-nodeport.yaml`
  - `values-exposure-lb.yaml`
- Demo commands:

```bash
make k8s-exposure-nodeport-demo
make k8s-exposure-lb-demo
```

## 4. ConfigMaps, Secrets, Storage

- Config/env runtime: `templates/configmap.yaml`
- Secret runtime: `templates/secret.yaml`
- PVC mặc định cho `Postgres` và `Kafka`
- Static PV demo cho Postgres:
  - `k8s/infrastructure/storage/postgres-static-pv.yaml`
  - `k8s/infrastructure/storage/postgres-static-pvc.yaml`
  - `values-static-pv-demo.yaml`
  - `make k8s-static-pv-demo`

## 5. Product-Oriented Constraints

- Dự án này không dùng workload giả để demo scale. HPA demo bắn tải vào chính `data_pipeline` qua internal ops endpoints.
- `core_trading` hiện là stateful singleton; muốn scale ngang an toàn cần tách session/runtime state và concurrency model trước.
- K8s được tích hợp theo hướng phục vụ app thật đang phát triển, không phải chỉ để “học YAML”.

## 6. Bot Evaluation & Simulator Realism

- Replay datasets cho benchmark hiện đi qua:
  - `GET /api/data/market/quotes/replay/catalog`
  - `GET /api/data/market/quotes/replay/catalog/:scenario_id`
- Bot evaluation hiện đi qua:
  - `GET /api/sim/runs`
  - `GET /api/sim/runs/:runId`
  - `GET /api/sim/leaderboard`
  - `POST /api/sim/runs`
- Built-in bots để học và mở rộng tiếp:
  - `baseline-roundtrip:v1`
  - `buy-and-hold:v1`
  - `moving-average-cross:v1`
- Mục tiêu product hiện tại là `simulation-first`: benchmark bot trên execution profile, fee/slippage, risk controls, timeline/report/audit của session paper trading, thay vì trade thật.
