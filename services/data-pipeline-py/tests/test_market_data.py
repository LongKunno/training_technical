from dataclasses import dataclass
from pathlib import Path

from app.core.app import create_app
from app.core.config import Settings
from app.schemas.market import PriceTick
from app.services.market_data import MockMarketDataService
from fastapi.testclient import TestClient


@dataclass
class FakePublisher:
    called: bool = False
    last_ticks: list[PriceTick] | None = None
    publish_calls: list[list[PriceTick]] | None = None
    transports: list[str] | None = None

    async def publish_ticks(self, ticks: list[PriceTick]) -> object:
        return await self.publish_ticks_with_transport(ticks, "http")

    async def publish_ticks_with_transport(self, ticks: list[PriceTick], transport: str) -> object:
        self.called = True
        self.last_ticks = ticks
        if self.publish_calls is None:
            self.publish_calls = []
        self.publish_calls.append(ticks)
        if self.transports is None:
            self.transports = []
        self.transports.append(transport)
        return type(
            "PublishResult",
            (),
            {
                "published_count": len(ticks),
                "symbols": [tick.symbol for tick in ticks],
                "transports": [transport],
            },
        )()


def fixture_path() -> str:
    return str(Path(__file__).resolve().parent.parent / "app" / "fixtures" / "mock_ticks.json")


def test_mock_market_data_service_loads_latest_quote() -> None:
    service = MockMarketDataService(fixture_path())

    quote = service.latest_quote("BTCUSDT")

    assert quote.price == 65500.0
    assert quote.source == "mock-replay"
    assert quote.scenario == "baseline"


def test_latest_quote_endpoint_returns_latest_tick() -> None:
    settings = Settings(market_data_fixture_path=fixture_path())
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/data/market/quotes/latest", params={"symbol": "BTCUSDT"})

    assert response.status_code == 200
    assert response.json()["quote"]["symbol"] == "BTCUSDT"
    assert response.json()["quote"]["price"] == 65500.0


def test_market_data_service_lists_scenarios() -> None:
    service = MockMarketDataService(fixture_path())

    assert service.scenarios() == [
        "baseline",
        "flash-crash-recovery",
        "range-chop",
        "trend-up",
        "volatility-spike",
    ]


def test_market_data_service_exposes_scenario_catalog() -> None:
    service = MockMarketDataService(fixture_path())

    catalog = service.scenario_catalog()

    assert any(entry.scenario_id == "trend-up" for entry in catalog)
    flash_crash = service.scenario_detail("flash-crash-recovery")
    assert flash_crash.tick_count >= 4
    assert "stress" in flash_crash.tags
    assert flash_crash.microstructure_profile.signal_latency_ticks == 2


def test_replay_ticks_endpoint_returns_ordered_ticks() -> None:
    settings = Settings(market_data_fixture_path=fixture_path())
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/data/market/quotes/replay", params={"scenario": "baseline"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["scenario"] == "baseline"
    assert payload["count"] == 4
    assert payload["ticks"][0]["symbol"] == "BTCUSDT"
    assert payload["ticks"][-1]["symbol"] == "ETHUSDT"


def test_scenario_catalog_endpoint_returns_metadata() -> None:
    settings = Settings(market_data_fixture_path=fixture_path())
    client = TestClient(create_app(settings=settings))

    response = client.get("/api/data/market/quotes/replay/catalog")

    assert response.status_code == 200
    scenarios = response.json()["scenarios"]
    assert any(item["scenario_id"] == "trend-up" for item in scenarios)
    assert scenarios[0]["microstructure_profile"]["max_fill_notional_per_tick"] >= 0


def test_publish_quotes_endpoint_calls_publisher() -> None:
    settings = Settings(market_data_fixture_path=fixture_path())
    service = MockMarketDataService(fixture_path())
    publisher = FakePublisher()
    client = TestClient(
        create_app(
            settings=settings,
            market_data_service=service,
            market_data_publisher=publisher,
        )
    )

    response = client.post("/api/data/market/quotes/publish")

    assert response.status_code == 200
    assert publisher.called is True
    assert publisher.last_ticks is not None
    assert len(publisher.last_ticks) == 2
    assert response.json()["published_count"] == 2
    assert response.json()["scenario"] == "baseline"


def test_replay_quotes_endpoint_replays_ticks_by_scenario() -> None:
    settings = Settings(market_data_fixture_path=fixture_path())
    service = MockMarketDataService(fixture_path())
    publisher = FakePublisher()
    client = TestClient(
        create_app(
            settings=settings,
            market_data_service=service,
            market_data_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/market/quotes/replay",
        json={"scenario": "volatility-spike", "speed_multiplier": 0},
    )

    assert response.status_code == 200
    assert response.json()["published_count"] == 2
    assert publisher.publish_calls is not None
    assert len(publisher.publish_calls) == 2
    assert publisher.publish_calls[0][0].scenario == "volatility-spike"
