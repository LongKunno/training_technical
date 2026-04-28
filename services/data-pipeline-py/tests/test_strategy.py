import json
from dataclasses import dataclass
from pathlib import Path

from app.core.app import create_app
from app.core.config import Settings
from app.schemas.strategy import StrategySignal
from app.services.strategy_data import MockStrategySignalService
from fastapi.testclient import TestClient


@dataclass
class FakeSignalPublisher:
    publish_calls: list[list[StrategySignal]]

    async def publish_signals(self, signals: list[StrategySignal]) -> object:
        self.publish_calls.append(signals)
        return type(
            "SignalPublishResult",
            (),
            {
                "published_count": len(signals),
                "signal_ids": [signal.signal_id for signal in signals],
                "strategy_ids": sorted({signal.strategy_id for signal in signals}),
                "transports": ["http"],
            },
        )()


@dataclass
class FailingSignalPublisher:
    publish_calls: int = 0

    async def publish_signals(self, signals: list[StrategySignal]) -> object:
        self.publish_calls += 1
        raise RuntimeError("core trading signal publish failed: connection refused")


def signal_fixture_path() -> str:
    return str(Path(__file__).resolve().parent.parent / "app" / "fixtures" / "mock_signals.json")


def test_strategy_signal_service_lists_signals() -> None:
    service = MockStrategySignalService(signal_fixture_path())

    signals = service.list_signals("baseline", "baseline-trend", limit=1, offset=0)

    assert len(signals) == 1
    assert signals[0].signal_id == "baseline-buy-btc"


def test_strategy_signal_service_replay_signals_are_sorted_by_timestamp_then_signal_id(
    tmp_path: Path,
) -> None:
    fixture = tmp_path / "signals.json"
    fixture.write_text(
        json.dumps(
            [
                {
                    "strategy_id": "test-strategy",
                    "signal_id": "sig-b",
                    "symbol": "BTCUSDT",
                    "side": "buy",
                    "notional": 100.0,
                    "price_hint": 100.0,
                    "timestamp": "2026-04-17T00:00:00Z",
                    "scenario": "custom",
                },
                {
                    "strategy_id": "test-strategy",
                    "signal_id": "sig-c",
                    "symbol": "BTCUSDT",
                    "side": "sell",
                    "quantity": 1.0,
                    "price_hint": 120.0,
                    "timestamp": "2026-04-17T00:01:00Z",
                    "scenario": "custom",
                },
                {
                    "strategy_id": "test-strategy",
                    "signal_id": "sig-a",
                    "symbol": "BTCUSDT",
                    "side": "buy",
                    "notional": 50.0,
                    "price_hint": 90.0,
                    "timestamp": "2026-04-17T00:00:00Z",
                    "scenario": "custom",
                },
            ],
        ),
        encoding="utf-8",
    )
    service = MockStrategySignalService(str(fixture))

    signals = service.replay_signals(scenario="custom")

    assert [(signal.timestamp.isoformat(), signal.signal_id) for signal in signals] == [
        ("2026-04-17T00:00:00+00:00", "sig-a"),
        ("2026-04-17T00:00:00+00:00", "sig-b"),
        ("2026-04-17T00:01:00+00:00", "sig-c"),
    ]


def test_strategy_signal_scenarios_endpoint() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/data/strategy/signals/scenarios")

    assert response.status_code == 200
    assert response.json()["scenarios"] == ["baseline", "volatility-spike"]


def test_publish_strategy_signals_endpoint_calls_publisher() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())
    publisher = FakeSignalPublisher(publish_calls=[])
    client = TestClient(
        create_app(
            settings=settings,
            strategy_signal_service=service,
            signal_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/strategy/signals/publish",
        json={"scenario": "baseline", "strategy_id": "baseline-trend", "limit": 1},
    )

    assert response.status_code == 200
    assert response.json()["published_count"] == 1
    assert publisher.publish_calls[0][0].signal_id == "baseline-buy-btc"


def test_publish_strategy_signals_endpoint_rejects_unknown_scenario_without_publish() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())
    publisher = FakeSignalPublisher(publish_calls=[])
    client = TestClient(
        create_app(
            settings=settings,
            strategy_signal_service=service,
            signal_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/strategy/signals/publish",
        json={"scenario": "missing-scenario"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "scenario not found: missing-scenario"
    assert publisher.publish_calls == []


def test_publish_strategy_signals_endpoint_returns_503_when_publisher_fails() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())
    publisher = FailingSignalPublisher()
    client = TestClient(
        create_app(
            settings=settings,
            strategy_signal_service=service,
            signal_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/strategy/signals/publish",
        json={"scenario": "baseline"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "core trading signal publish failed: connection refused"
    assert publisher.publish_calls == 1


def test_replay_strategy_signals_endpoint_replays_scenario() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())
    publisher = FakeSignalPublisher(publish_calls=[])
    client = TestClient(
        create_app(
            settings=settings,
            strategy_signal_service=service,
            signal_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/strategy/signals/replay",
        json={"scenario": "volatility-spike", "speed_multiplier": 0},
    )

    assert response.status_code == 200
    assert response.json()["published_count"] == 2
    assert len(publisher.publish_calls) == 2


def test_replay_strategy_signals_endpoint_defaults_to_immediate_replay_speed() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())
    publisher = FakeSignalPublisher(publish_calls=[])
    client = TestClient(
        create_app(
            settings=settings,
            strategy_signal_service=service,
            signal_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/strategy/signals/replay",
        json={"scenario": "volatility-spike"},
    )

    assert response.status_code == 200
    assert response.json()["speed_multiplier"] == 0.0
    assert len(publisher.publish_calls) == 2


def test_replay_strategy_signals_endpoint_rejects_speed_multiplier_outside_bounds() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())

    for speed_multiplier in (-0.1, 1000.1):
        publisher = FakeSignalPublisher(publish_calls=[])
        client = TestClient(
            create_app(
                settings=settings,
                strategy_signal_service=service,
                signal_publisher=publisher,
            )
        )

        response = client.post(
            "/api/data/strategy/signals/replay",
            json={
                "scenario": "volatility-spike",
                "speed_multiplier": speed_multiplier,
            },
        )

        assert response.status_code == 422
        assert publisher.publish_calls == []


def test_replay_strategy_signals_endpoint_rejects_unknown_scenario_without_publish() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())
    publisher = FakeSignalPublisher(publish_calls=[])
    client = TestClient(
        create_app(
            settings=settings,
            strategy_signal_service=service,
            signal_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/strategy/signals/replay",
        json={"scenario": "missing-scenario"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "scenario not found: missing-scenario"
    assert publisher.publish_calls == []


def test_replay_strategy_signals_endpoint_returns_503_when_publisher_fails() -> None:
    settings = Settings(strategy_signal_fixture_path=signal_fixture_path())
    service = MockStrategySignalService(signal_fixture_path())
    publisher = FailingSignalPublisher()
    client = TestClient(
        create_app(
            settings=settings,
            strategy_signal_service=service,
            signal_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/strategy/signals/replay",
        json={"scenario": "volatility-spike"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "core trading signal publish failed: connection refused"
    assert publisher.publish_calls == 1
