import asyncio
import json
from datetime import UTC, datetime

import app.services.publisher as publisher_module
from app.schemas.market import PriceTick
from app.services.publisher import MarketDataPublisher


class DummyResponse:
    def raise_for_status(self) -> None:
        return None


class RecordingAsyncClient:
    def __init__(self, calls: list[tuple[str, dict[str, object]]], timeout: float) -> None:
        self._calls = calls
        self._timeout = timeout

    async def __aenter__(self) -> "RecordingAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, json: dict[str, object]) -> DummyResponse:
        self._calls.append((url, json))
        return DummyResponse()


class FakeKafkaProducer:
    def __init__(self, messages: list[tuple[str, bytes]], bootstrap_servers: str) -> None:
        self._messages = messages
        self.bootstrap_servers = bootstrap_servers
        self.started = False
        self.stopped = False

    async def start(self) -> None:
        self.started = True

    async def send_and_wait(self, topic: str, value: bytes) -> None:
        self._messages.append((topic, value))

    async def stop(self) -> None:
        self.stopped = True


def test_market_data_publisher_posts_ticks_to_core_trading(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        publisher_module.httpx,
        "AsyncClient",
        lambda timeout: RecordingAsyncClient(calls, timeout),
    )

    publisher = MarketDataPublisher(
        core_trading_internal_base_url="http://core_trading:8080",
        kafka_bootstrap_servers="",
        kafka_topic="price-ticks-v1",
    )

    result = asyncio.run(
        publisher.publish_ticks(
            [
                PriceTick(
                    symbol="BTCUSDT",
                    price=65500,
                    source="mock-replay",
                    timestamp=datetime(2026, 4, 17, 0, 5, tzinfo=UTC),
                )
            ]
        )
    )

    assert result.published_count == 1
    assert result.transports == ["http"]
    assert calls == [
        (
            "http://core_trading:8080/internal/market/prices",
            {
                "ticks": [
                    {
                        "symbol": "BTCUSDT",
                        "price": 65500.0,
                        "source": "mock-replay",
                        "timestamp": "2026-04-17T00:05:00Z",
                    }
                ]
            },
        )
    ]


def test_market_data_publisher_also_publishes_to_kafka_when_enabled(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    messages: list[tuple[str, bytes]] = []
    monkeypatch.setattr(
        publisher_module.httpx,
        "AsyncClient",
        lambda timeout: RecordingAsyncClient(calls, timeout),
    )
    monkeypatch.setattr(
        publisher_module,
        "AIOKafkaProducer",
        lambda bootstrap_servers: FakeKafkaProducer(messages, bootstrap_servers),
    )

    publisher = MarketDataPublisher(
        core_trading_internal_base_url="http://core_trading:8080",
        kafka_bootstrap_servers="kafka:9092",
        kafka_topic="price-ticks-v1",
    )

    result = asyncio.run(
        publisher.publish_ticks(
            [
                PriceTick(
                    symbol="ETHUSDT",
                    price=3215,
                    source="mock-replay",
                    timestamp=datetime(2026, 4, 17, 0, 5, tzinfo=UTC),
                )
            ]
        )
    )

    assert result.transports == ["http", "kafka"]
    assert len(messages) == 1
    assert messages[0][0] == "price-ticks-v1"
    assert json.loads(messages[0][1].decode("utf-8")) == {
        "symbol": "ETHUSDT",
        "price": 3215.0,
        "source": "mock-replay",
        "timestamp": "2026-04-17T00:05:00Z",
    }


def test_market_data_publisher_supports_kafka_only_transport(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    messages: list[tuple[str, bytes]] = []
    monkeypatch.setattr(
        publisher_module.httpx,
        "AsyncClient",
        lambda timeout: RecordingAsyncClient(calls, timeout),
    )
    monkeypatch.setattr(
        publisher_module,
        "AIOKafkaProducer",
        lambda bootstrap_servers: FakeKafkaProducer(messages, bootstrap_servers),
    )

    publisher = MarketDataPublisher(
        core_trading_internal_base_url="http://core_trading:8080",
        kafka_bootstrap_servers="kafka:9092",
        kafka_topic="price-ticks-v1",
    )

    result = asyncio.run(
        publisher.publish_ticks_with_transport(
            [
                PriceTick(
                    symbol="BTCUSDT",
                    price=65000,
                    source="mock-replay",
                    timestamp=datetime(2026, 4, 17, 0, 0, tzinfo=UTC),
                )
            ],
            "kafka",
        )
    )

    assert result.transports == ["kafka"]
    assert calls == []
    assert len(messages) == 1
