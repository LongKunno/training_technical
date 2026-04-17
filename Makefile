.PHONY: up down test test-go test-py lint-go lint-py migrate-up migrate-down smoke-paper smoke-paper-kafka smoke-restore clean-docker clean-docker-all

up:
	docker compose up --build

down:
	docker compose down --remove-orphans

test: test-go test-py

test-go:
	docker compose build core_trading
	docker compose run --rm --no-deps core_trading sh -lc '/usr/local/go/bin/go test ./...'

test-py:
	docker compose build data_pipeline
	docker compose run --rm --no-deps data_pipeline sh -lc 'if [ -d tests ]; then PYTHONPATH=/app pytest; else echo "No Python tests found."; fi'

lint-go:
	docker compose build core_trading
	docker compose run --rm --no-deps core_trading sh -lc 'export PATH=/usr/local/go/bin:$$PATH && apk add --no-cache git >/dev/null && GOBIN=/tmp/bin go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.1.6 && /tmp/bin/golangci-lint run ./...'

lint-py:
	docker compose build data_pipeline
	docker compose run --rm --no-deps data_pipeline sh -lc 'ruff check app tests'

migrate-up:
	docker compose up migrations

migrate-down:
	docker compose up -d postgres
	docker compose run --rm migrations -path=/migrations -database=postgres://root:rootpassword@postgres:5432/crypto_sim?sslmode=disable down 1

smoke-paper:
	docker compose up -d postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps smoke_runner

smoke-paper-kafka:
	docker compose up -d postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-paper-kafka.sh" smoke_runner

smoke-restore:
	docker compose up -d postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-session-restore-prepare.sh" smoke_runner
	docker compose restart core_trading
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-session-restore-verify.sh" smoke_runner

clean-docker:
	docker compose down --remove-orphans

clean-docker-all:
	docker compose down -v --remove-orphans
