# Crypto Trading Simulator (Microservices)

Một dự án thiết kế chuẩn thực chiến để luyện tập kiến trúc phân tán (Distributed System), Xử lý đa luồng (Multi-threading), và Design Patterns.

## Cấu trúc bộ khung (Architecture)
Hệ thống được chia làm 2 Microservices độc lập, giao tiếp với nhau theo mô hình Event-Driven thông qua **Kafka**:

1. **`core-trading-go`** (Golang): Lõi xử lý trading, tính toán chỉ báo và Websocket.
2. **`data-pipeline-py`** (Python): Crawler bất đồng bộ, xử lý file và background jobs.

## Các tài liệu cần đọc (Mục Docs)
Là một AI (hoặc thành viên mới), vui lòng tham khảo các tài liệu chuyên sâu đặt tại thư mục `docs/`:

- [Kiến trúc hệ thống chi tiết](docs/architecture.md)
- [Ánh xạ chức năng vào lộ trình thực hành](docs/roadmap_mapping.md)

*(Quy tắc chung cho AI Agent đã được định nghĩa tại file `.antigravityrules` nằm ở root thư mục)*
