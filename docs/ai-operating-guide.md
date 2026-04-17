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
- Dashboard nội bộ `services/simulator-ui` đã có:
  - static operator console chạy qua nginx
  - reverse proxy `/core/*` sang Go
  - reverse proxy `/data/*` sang Python
  - session controls, market replay, strategy publish/replay, portfolio/report/rules snapshots, orders, positions, audit feed
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
- Không tự mở rộng phạm vi sang trading thật; repo hiện vẫn là paper trading simulator.
- Rule repo bắt buộc cần nhớ: mọi loại test chỉ được chạy trong Docker.

## 5. Commands tham khảo

### Đọc repo

```bash
rg --files
git status --short
```

### Chạy local

```bash
cp .env.example .env
make up
```

### Health check

```bash
curl http://localhost:18080/health
curl http://localhost:18000/health
```

### Dashboard

```bash
http://localhost:18020
```

### Verify trong Docker

```bash
make lint-go
make lint-py
make test-go
make test-py
make smoke-paper
make smoke-paper-kafka
make smoke-restore
```

### Cleanup

```bash
make clean-docker
make clean-docker-all
```

## 6. Khi nào phải cập nhật progress tracker

Cập nhật `docs/progress-tracker.md` nếu task làm thay đổi một trong các phần sau:

- trạng thái implementation
- lệnh chạy hoặc lệnh verify
- milestone đã xong
- blocker mới
- quyết định kiến trúc mới
