from app.core.app import create_app
from app.core.config import Settings
from fastapi.testclient import TestClient


def test_ops_benchmark_endpoints_return_not_found_when_disabled() -> None:
    client = TestClient(create_app())

    response = client.post("/internal/ops/benchmark/cpu", json={"duration_ms": 100})

    assert response.status_code == 404


def test_ops_benchmark_endpoints_require_token() -> None:
    settings = Settings(
        ops_benchmark_enabled=True,
        ops_benchmark_token="secret-token",
    )
    client = TestClient(create_app(settings=settings))

    response = client.post("/internal/ops/benchmark/cpu", json={"duration_ms": 100})

    assert response.status_code == 403


def test_cpu_benchmark_endpoint_runs_when_enabled() -> None:
    settings = Settings(
        ops_benchmark_enabled=True,
        ops_benchmark_token="secret-token",
    )
    client = TestClient(create_app(settings=settings))

    response = client.post(
        "/internal/ops/benchmark/cpu",
        headers={"x-ops-token": "secret-token"},
        json={"duration_ms": 100, "outer_loops": 10000},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["kind"] == "cpu"
    assert payload["completed_loops"] >= 10000


def test_memory_benchmark_endpoint_runs_when_enabled() -> None:
    settings = Settings(
        ops_benchmark_enabled=True,
        ops_benchmark_token="secret-token",
    )
    client = TestClient(create_app(settings=settings))

    response = client.post(
        "/internal/ops/benchmark/memory",
        headers={"x-ops-token": "secret-token"},
        json={"duration_ms": 100, "allocation_mib": 8},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["kind"] == "memory"
    assert payload["allocation_mib"] == 8
