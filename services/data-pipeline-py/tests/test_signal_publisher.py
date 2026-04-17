import asyncio
from datetime import UTC, datetime

import app.services.signal_publisher as signal_publisher_module
from app.schemas.strategy import StrategySignal
from app.services.signal_publisher import SignalPublisher


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


def test_signal_publisher_posts_signals_to_core_trading(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        signal_publisher_module.httpx,
        "AsyncClient",
        lambda timeout: RecordingAsyncClient(calls, timeout),
    )

    publisher = SignalPublisher(core_trading_internal_base_url="http://core_trading:8080")
    result = asyncio.run(
        publisher.publish_signals(
            [
                StrategySignal(
                    strategy_id="baseline-trend",
                    signal_id="baseline-buy-btc",
                    symbol="BTCUSDT",
                    side="buy",
                    notional=100,
                    price_hint=100,
                    timestamp=datetime(2026, 4, 17, 0, 0, tzinfo=UTC),
                )
            ]
        )
    )

    assert result.published_count == 1
    assert result.transports == ["http"]
    assert calls == [
        (
            "http://core_trading:8080/internal/signals",
            {
                "strategy_id": "baseline-trend",
                "signal_id": "baseline-buy-btc",
                "symbol": "BTCUSDT",
                "side": "buy",
                "quantity": 0.0,
                "notional": 100.0,
                "price_hint": 100.0,
                "timestamp": "2026-04-17T00:00:00Z",
            },
        )
    ]
