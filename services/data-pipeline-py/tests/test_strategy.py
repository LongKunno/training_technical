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


def signal_fixture_path() -> str:
    return str(Path(__file__).resolve().parent.parent / "app" / "fixtures" / "mock_signals.json")


def test_strategy_signal_service_lists_signals() -> None:
    service = MockStrategySignalService(signal_fixture_path())

    signals = service.list_signals("baseline", "baseline-trend", limit=1, offset=0)

    assert len(signals) == 1
    assert signals[0].signal_id == "baseline-buy-btc"


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
