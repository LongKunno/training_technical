import json
from pathlib import Path

from app.core.app import create_app
from app.core.config import Settings
from fastapi.testclient import TestClient


def test_health_endpoint_returns_service_status() -> None:
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "Data Pipeline (Python)",
        "message": "San sang hoat dong, dang hung du lieu tu san Crypto!",
    }


def test_ready_endpoint_returns_fixture_status() -> None:
    client = TestClient(create_app())

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["checks"]["market_fixture"]["status"] == "ok"
    assert payload["checks"]["market_fixture"]["scenario_count"] >= 5
    assert "baseline" in payload["checks"]["market_fixture"]["scenarios"]
    assert payload["checks"]["strategy_fixture"]["status"] == "ok"
    assert payload["checks"]["strategy_fixture"]["scenario_count"] >= 2


def test_ready_endpoint_returns_503_when_fixtures_are_empty(tmp_path: Path) -> None:
    market_fixture = tmp_path / "ticks.json"
    strategy_fixture = tmp_path / "signals.json"
    market_fixture.write_text(json.dumps([]), encoding="utf-8")
    strategy_fixture.write_text(json.dumps([]), encoding="utf-8")
    settings = Settings(
        market_data_fixture_path=str(market_fixture),
        strategy_signal_fixture_path=str(strategy_fixture),
    )
    client = TestClient(create_app(settings=settings))

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json()["detail"] == "fixtures are not ready"
