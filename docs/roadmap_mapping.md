# Roadmap & Learning Objectives Mapping 🗺️

Dự án này mang tính giáo dục thực chiến cao, không chỉ là code tính năng mà còn là hoàn thiện kỹ thuật. Dưới đây là cách ánh xạ (mapping) các yêu cầu kỹ thuật của bạn vào thẳng các tính năng trong Source Code.

## 1. Core & QA (Xử lý bất đồng bộ - Async/Await)
- **Nghiên cứu Event Loop & Thread Pool:** Đã giải thích ở lý thuyết. Trong code, phần Python FastAPI sẽ dùng 100% `async/await` với HTTP client như `aiohttp` hoặc `httpx` để thể hiện Event Loop. Phần Golang sẽ dùng Goroutines để thể hiện cơ chế tương tự Thread Pool (M:N scheduling).
- **Thực hành code Async xử lý Exception:** Xây dựng một module Retry an toàn. Khi gọi sàn Binance bị xịt (Timeout/429 Too Many Requests), luồng Async sẽ nghỉ 2s rồi request lại.
- **Tích hợp:** Nó nằm ở lõi của Service Python.

## 2. Multi-threading (Đa luồng)
- **Race conditions, Deadlocks, Mutex:** Sẽ tạo một bài toán trong Service Golang: Có nhiều Bot cùng trừ chung 1 tài khoản (Balance) trong bộ nhớ. Rất dễ bị Race condition (Âm tiền). Cần sử dụng `sync.Mutex` Lock/Unlock để phân luồng, chứng minh chống chập chờn bộ nhớ.
- **Xử lý file/Crawl data:** Tool crawler ở nhánh Python sẽ được viết theo dạng ThreadPool để quét nhiều biểu đồ cùng lúc.

## 3. Clean Code & Performance
- **Memory Leak Profiling:** Ở phase sau, ta cố tình viết một vòng lặp không giải phóng context trong Golang để hệ thống ngốn RAM dần dần. Dùng tool `pprof` gắn vào Go để profile xuất report, tìm ra dòng code rỉ RAM và sửa nó (`Fix memory leak`).
- **Refactor Cấu trúc dữ liệu:** Áp dụng Design Patterns.

## 4. Design Patterns (System Arch)
- **Creational (Factory/Builder):** Viết pattern ở Go để tạo cấu hình cho Bot (Scalping Bot, Holding Bot) thông qua `BotFactory`.
- **Behavioral (Observer/Strategy):** Tương tự, nếu dùng chiến thuật phân kỳ (RSI Divergence) - sẽ xài Strategy Pattern. Nếu có lệnh khớp (Order Filled), xài Observer văng tín hiệu ra Websocket về Frontend.
- **Singleton:** Dùng để tạo class kết nối Database cho hệ thống (đảm bảo không bao giờ tồn tại >1 connection pool).

## 5. Security & Scalability
- **OWASP Top 10:** Quản lý input người dùng trong Nest/Go (SQL Injection phòng tránh bằng ORM Parameterized). Quản lý JWT Token bảo mật.
- **Scalability:** Bắn JMeter test sập server, dùng Kubernetes HPA để scale ngang máy chủ cứu gánh.

## 6. DevOps & Microservices (Hạ tầng)
- Cài Minikube để chơi với `Pods, ReplicaSets`.
- Mọi Config DB phải lấy qua `K8s ConfigMaps & Secrets`. Không push cứng vào code.
- Setup `API Gateway Kong` đứng đầu mạng lưới (Che giấu IP nội bộ).
