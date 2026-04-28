import json
import logging
from collections.abc import Iterator

from app.core.app import create_app
from app.core.config import Settings
from fastapi.testclient import TestClient


def request_log_payloads(caplog) -> Iterator[dict[str, object]]:
    for record in caplog.records:
        if record.name != "data_pipeline.request":
            continue
        yield json.loads(record.message)


def latest_request_log(caplog) -> dict[str, object]:
    return list(request_log_payloads(caplog))[-1]


def test_market_request_log_includes_request_id_and_replay_context(caplog) -> None:
    caplog.set_level(logging.INFO, logger="data_pipeline.request")
    client = TestClient(create_app())

    response = client.get(
        "/api/data/market/quotes/replay",
        headers={"x-request-id": "market-request-1"},
        params={"scenario": "baseline"},
    )

    payload = latest_request_log(caplog)
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "market-request-1"
    assert payload["event"] == "http_request"
    assert payload["service"] == "data_pipeline"
    assert payload["method"] == "GET"
    assert payload["path"] == "/api/data/market/quotes/replay"
    assert payload["request_id"] == "market-request-1"
    assert payload["status"] == 200
    assert payload["scenario"] == "baseline"
    assert payload["tick_count"] == response.json()["count"]


def test_strategy_request_log_includes_listing_context(caplog) -> None:
    caplog.set_level(logging.INFO, logger="data_pipeline.request")
    client = TestClient(create_app())

    response = client.get(
        "/api/data/strategy/signals",
        params={
            "scenario": "baseline",
            "strategy_id": "baseline-trend",
            "limit": 1,
            "offset": 0,
        },
    )

    payload = latest_request_log(caplog)
    assert response.status_code == 200
    assert response.headers["x-request-id"]
    assert payload["event"] == "http_request"
    assert payload["path"] == "/api/data/strategy/signals"
    assert payload["status"] == 200
    assert payload["scenario"] == "baseline"
    assert payload["strategy_id"] == "baseline-trend"
    assert payload["limit"] == 1
    assert payload["offset"] == 0
    assert payload["signal_count"] == len(response.json()["signals"])


def test_ops_request_log_includes_benchmark_context_without_token(caplog) -> None:
    caplog.set_level(logging.INFO, logger="data_pipeline.request")
    settings = Settings(
        ops_benchmark_enabled=True,
        ops_benchmark_token="secret-token",
    )
    client = TestClient(create_app(settings=settings))

    response = client.post(
        "/internal/ops/benchmark/cpu",
        headers={"x-ops-token": "wrong-token"},
        json={"duration_ms": 100, "outer_loops": 10000},
    )

    payload = latest_request_log(caplog)
    assert response.status_code == 403
    assert payload["event"] == "http_request"
    assert payload["path"] == "/internal/ops/benchmark/cpu"
    assert payload["status"] == 403
    assert payload["kind"] == "cpu"
    assert payload["benchmark_duration_ms"] == 100
    assert payload["outer_loops"] == 10000
    assert "x-ops-token" not in payload
