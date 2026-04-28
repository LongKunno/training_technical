import json
from dataclasses import dataclass
from pathlib import Path

import pytest
from app.core.app import create_app
from app.core.config import Settings
from app.schemas.market import MarketMicrostructureProfile, PriceTick
from app.services.market_data import MockMarketDataService
from fastapi.testclient import TestClient
from pydantic import ValidationError


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


@dataclass
class FailingPublisher:
    called: bool = False

    async def publish_ticks(self, ticks: list[PriceTick]) -> object:
        return await self.publish_ticks_with_transport(ticks, "http")

    async def publish_ticks_with_transport(self, ticks: list[PriceTick], transport: str) -> object:
        self.called = True
        raise RuntimeError("core trading market publish failed: connection refused")


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
    assert flash_crash.microstructure_profile.cancel_after_ticks == 2
    assert flash_crash.microstructure_profile.market_impact_bps_per_10k == 8.0
    assert flash_crash.microstructure_profile.liquidity_curve[0].fill_ratio == 0.65


def test_market_data_service_has_metadata_for_all_standard_scenarios() -> None:
    service = MockMarketDataService(fixture_path())

    catalog = {entry.scenario_id: entry for entry in service.scenario_catalog()}

    assert set(catalog) == {
        "baseline",
        "flash-crash-recovery",
        "range-chop",
        "trend-up",
        "volatility-spike",
    }
    for entry in catalog.values():
        assert entry.name
        assert entry.description
        assert entry.tags
        assert entry.symbols
        assert entry.tick_count > 0
        assert entry.started_at <= entry.ended_at
        assert entry.microstructure_profile.spread_bps > 0
        assert entry.microstructure_profile.max_fill_notional_per_tick > 0
        assert entry.microstructure_profile.liquidity_curve


def test_standard_scenarios_expose_operator_tags() -> None:
    service = MockMarketDataService(fixture_path())
    catalog = {entry.scenario_id: entry for entry in service.scenario_catalog()}

    assert "trend" in catalog["trend-up"].tags
    assert "chop" in catalog["range-chop"].tags
    assert "crash" in catalog["flash-crash-recovery"].tags
    assert "liquidity-thin" in catalog["flash-crash-recovery"].tags
    assert "volatility-spike" in catalog["volatility-spike"].tags


def test_market_microstructure_profile_rejects_invalid_values() -> None:
    invalid_profiles = [
        {"signal_latency_ticks": -1},
        {"spread_bps": -0.1},
        {"max_fill_notional_per_tick": -1},
        {"liquidity_curve": [{"max_notional": 100, "fill_ratio": 1.1}]},
        {"liquidity_curve": [{"max_notional": -100, "fill_ratio": 0.5}]},
        {"queue_priority": 1.1},
        {"market_impact_bps_per_10k": -0.1},
        {"cancel_after_ticks": -1},
    ]

    for profile in invalid_profiles:
        with pytest.raises(ValidationError):
            MarketMicrostructureProfile.model_validate(profile)


def test_market_data_service_replay_ticks_are_sorted_by_timestamp_then_symbol(
    tmp_path: Path,
) -> None:
    fixture = tmp_path / "ticks.json"
    fixture.write_text(
        json.dumps(
            [
                {
                    "symbol": "ETHUSDT",
                    "price": 3200.0,
                    "source": "test",
                    "timestamp": "2026-04-17T00:01:00Z",
                    "scenario": "custom",
                },
                {
                    "symbol": "ETHUSDT",
                    "price": 3190.0,
                    "source": "test",
                    "timestamp": "2026-04-17T00:00:00Z",
                    "scenario": "custom",
                },
                {
                    "symbol": "BTCUSDT",
                    "price": 65000.0,
                    "source": "test",
                    "timestamp": "2026-04-17T00:00:00Z",
                    "scenario": "custom",
                },
            ],
        ),
        encoding="utf-8",
    )
    service = MockMarketDataService(str(fixture))

    ticks = service.replay_ticks(scenario="custom")

    assert [(tick.timestamp.isoformat(), tick.symbol) for tick in ticks] == [
        ("2026-04-17T00:00:00+00:00", "BTCUSDT"),
        ("2026-04-17T00:00:00+00:00", "ETHUSDT"),
        ("2026-04-17T00:01:00+00:00", "ETHUSDT"),
    ]


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
    assert "liquidity_curve" in scenarios[0]["microstructure_profile"]
    assert "market_impact_bps_per_10k" in scenarios[0]["microstructure_profile"]


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


def test_publish_quotes_endpoint_rejects_unknown_scenario_without_publish() -> None:
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
        "/api/data/market/quotes/publish",
        json={"scenario": "missing-scenario"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "scenario not found: missing-scenario"
    assert publisher.called is False


def test_publish_quotes_endpoint_returns_503_when_publisher_fails() -> None:
    settings = Settings(market_data_fixture_path=fixture_path())
    service = MockMarketDataService(fixture_path())
    publisher = FailingPublisher()
    client = TestClient(
        create_app(
            settings=settings,
            market_data_service=service,
            market_data_publisher=publisher,
        )
    )

    response = client.post(
        "/api/data/market/quotes/publish",
        json={"scenario": "baseline"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "core trading market publish failed: connection refused"
    assert publisher.called is True


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


def test_replay_quotes_endpoint_defaults_to_immediate_replay_speed() -> None:
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
        json={"scenario": "volatility-spike"},
    )

    assert response.status_code == 200
    assert response.json()["speed_multiplier"] == 0.0
    assert publisher.publish_calls is not None
    assert len(publisher.publish_calls) == 2


def test_replay_quotes_endpoint_rejects_speed_multiplier_outside_bounds() -> None:
    settings = Settings(market_data_fixture_path=fixture_path())
    service = MockMarketDataService(fixture_path())

    for speed_multiplier in (-0.1, 1000.1):
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
            json={
                "scenario": "volatility-spike",
                "speed_multiplier": speed_multiplier,
            },
        )

        assert response.status_code == 422
        assert publisher.called is False


def test_replay_quotes_endpoint_rejects_unknown_scenario_without_publish() -> None:
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
        json={"scenario": "missing-scenario"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "scenario not found: missing-scenario"
    assert publisher.called is False
