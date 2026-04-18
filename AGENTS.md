# Repository Guidelines

## Project Structure & Module Organization

This repo is a small microservice stack:

- `services/core-trading-go`: Go paper-trading engine. Entry point lives in `cmd/api`; business logic is under `internal/` (`handlers`, `papertrading`, `server`, `storage`); SQL migrations are in `migrations/`.
- `services/data-pipeline-py`: Python mock market/strategy data service. Runtime code is under `app/`; tests live in `tests/`; JSON fixtures are in `app/fixtures/`.
- `services/simulator-ui`: React + Vite + TypeScript operator UI. Routes are in `src/app/routes`; feature code is in `src/features/*`; shared API, state, UI, and chart helpers are in `src/shared/*`.
- `scripts/`: Docker smoke scripts such as `smoke-paper-trading.sh` and restore/Kafka variants.
- `docs/` and `README.md`: architecture, progress, and operating notes.

## Build, Test, and Development Commands

- `make up`: build and start the full stack with Docker Compose.
- `make down`: stop containers and remove orphans.
- `make test-go`, `make lint-go`: run Go tests/lint in Docker.
- `make test-py`, `make lint-py`: run Python tests/lint in Docker.
- `make smoke-paper`, `make smoke-paper-kafka`, `make smoke-restore`: end-to-end smoke verification in Docker.
- `make typecheck-ui`, `make lint-ui`, `make test-ui`, `make build-ui`, `make test-e2e-ui`: local UI quality gates.
- `npm --prefix services/simulator-ui run dev`: run the UI dev server only.

## Coding Style & Naming Conventions

- Go: keep packages lowercase, exported symbols `PascalCase`, and follow `gofmt`/`golangci-lint`.
- Python: use `snake_case`, type hints where practical, and keep `ruff` clean.
- Frontend: React components and route files use `PascalCase`; hooks start with `use`; shared helpers/types stay in `src/shared`.
- Prefer small, domain-oriented modules over generic utility dumping grounds.

## Testing Guidelines

- Backend verification is Docker-only per `.antigravityrules`: do not run host `go test` or `pytest` for project validation.
- UI unit tests use `Vitest`; e2e uses `Playwright`; keep test files near the shared code they cover or under the configured e2e area.
- Before opening a PR, run the relevant service checks plus at least one smoke flow when contracts or integration behavior change.

## Commit & Pull Request Guidelines

- Follow the existing commit style: short prefixes such as `feat: ...`, `ci: ...`, `checkpoint: ...`.
- Keep subjects imperative and scoped to one logical change.
- PRs should include: purpose, affected services, verification commands run, and screenshots for UI-visible changes.
- If API contracts, ports, or workflows change, update `README.md` and `docs/progress-tracker.md` in the same PR.

## Security & Configuration Tips

- Start from `.env.example`; never commit secrets or local-only credentials.
- Do not commit generated artifacts such as `node_modules/`, `dist/`, or temporary build outputs unless explicitly required.
