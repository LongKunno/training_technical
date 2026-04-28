# Chỉ mục tri thức BMad

Tạo lúc: 2026-04-28 15:54:33 +07
Dự án: `crypto-trading-simulator`
Nguồn sự thật: cây `_bmad-output/`. Thư mục `docs/` cũ không còn dùng trong workflow repo.

## Thứ tự đọc bắt buộc

1. [Project Context](project-context.md)
2. [Tổng quan dự án](planning-artifacts/project-overview.md)
3. [Kiến trúc](planning-artifacts/architecture.md)
4. [API contracts](planning-artifacts/api-contracts.md)
5. [Source tree](planning-artifacts/source-tree.md)
6. [Progress tracker](implementation-artifacts/progress-tracker.md)
7. [Sprint status](implementation-artifacts/sprint-status.yaml)
8. [Verification matrix](test-artifacts/verification-matrix.md)

## Phân loại hiện tại

- Kiểu repo: monorepo nhiều service.
- Hình thái sản phẩm: crypto paper-trading simulator và bot-evaluation platform.
- Runtime stack: Go core trading engine, Python data pipeline, Python bot runner, React/Vite UI, Postgres, Redis, Kafka.
- Runtime local chính: `kind + Helm`.
- Docker Compose: fallback runtime và đường chạy quality gate/smoke hiện có.

## Chính sách tài liệu

- Không tạo hoặc cập nhật `docs/`.
- Tri thức dùng chung cho BMad/team nằm trong `_bmad-output/`.
- Override cá nhân BMad dạng `*.user.toml` không được đưa lên Git.
- Nếu source code và artifact BMad lệch nhau, tin source code trước rồi cập nhật `_bmad-output/`.
