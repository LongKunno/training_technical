# Roadmap

Tạo lúc: 2026-04-28 15:54:33 +07

## Ưu tiên hiện tại

1. Giữ BMad artifacts là knowledge base dùng chung duy nhất.
2. Ổn định verification quanh Docker-only quality gates.
3. Giữ semantics của simulation run/experiment/leaderboard rõ ràng khi execution realism và UI workflow tiếp tục phát triển.
4. Giữ K8s runtime đủ tin cậy cho demo local, không scale stateful Core quá sớm.

## Backlog đang mở

### Verification

- Giữ Docker-only verification matrix trong `_bmad-output/test-artifacts/verification-matrix.md` luôn đúng.
- Chạy gates liên quan sau code changes; không dùng host language test commands để xác nhận.
- Giữ smoke artifacts khi debug simulation hoặc UI runtime failures.

### Experiment Lab

- Tiếp tục harden large matrices, queue promotion, stop/cancel, restore, heartbeat stale và failure-injection cases.
- Giữ `/api/sim/leaderboard` standalone-only.
- Giữ experiment aggregate comparison trong experiment detail/summary.

### Execution Realism

- Duy trì deterministic fill degradation: latency, spread, fill cap, liquidity curve, queue priority, impact, cancel-after-ticks.
- Giữ pending execution persistence/restore có test.
- Giữ run snapshots immutable để so sánh lịch sử.

### Operator UI

- Giữ route split rõ:
  - `/dashboard`: current live monitor
  - `/lab`: manual/replay controls
  - `/sessions`: historical paper sessions
  - `/runs`: standalone bot runs
  - `/experiments`: batch matrix workflows
  - `/leaderboard`: standalone ranking
- Giữ internal endpoint blockers được cover trong runtime và Vite dev proxy.
- Giữ layout table/detail ổn trên mobile/desktop với id dài và metric rộng.

### Runtime Và K8s

- Chạy lại Helm lint/template và K8s smoke/restore khi chart, values, migrations hoặc service env contracts đổi.
- Giữ `core_trading` singleton cho đến khi ownership/reconciliation model được thiết kế và test.
- Dùng `data_pipeline` cho HPA demos.

### Observability

- Giữ structured request logs và lifecycle logs cho core, data, bot runner và UI.
- Giữ context `request_id`, `run_id`, `experiment_id`, `session_id` ở những nơi có thể.
- Tiếp tục surface terminal reasons nhất quán ở API/UI.

### Security Và Config

- Không thêm real exchange credentials.
- Giữ `.env.example` chỉ là demo/local config.
- Không expose internal ops và bot runner endpoints qua browser proxy.
- Giữ personal BMad config bị ignore.
