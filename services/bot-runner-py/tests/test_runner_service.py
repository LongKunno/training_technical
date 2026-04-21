import asyncio
from datetime import UTC, datetime

from app.schemas.runner import ReplayTick, StartRunRequest
from app.services.runner_service import RunnerService, SignalEnvelope


class SpyRunnerService(RunnerService):
    def __init__(self) -> None:
        super().__init__("http://core", "http://data", request_timeout_seconds=0.1)
        self.published_ticks: list[ReplayTick] = []
        self.published_signals: list[SignalEnvelope] = []
        self.heartbeats: list[str] = []

    async def _publish_tick(self, client, tick: ReplayTick) -> None:  # type: ignore[override]
        self.published_ticks.append(tick)

    async def _publish_signal(self, client, signal: SignalEnvelope) -> None:  # type: ignore[override]
        self.published_signals.append(signal)

    async def _notify_heartbeat(self, client, run_id: str) -> None:  # type: ignore[override]
        self.heartbeats.append(run_id)


def make_tick(symbol: str, price: float, second: int) -> ReplayTick:
    return ReplayTick(
        symbol=symbol,
        price=price,
        source="mock-replay",
        timestamp=datetime(2026, 4, 21, 10, 0, second, tzinfo=UTC),
        scenario="baseline",
    )


def make_payload(bot_id: str, *, scenario_id: str = "baseline", config: dict | None = None) -> StartRunRequest:
    return StartRunRequest(
        run_id=f"{bot_id}-run",
        bot_id=bot_id,
        bot_version="v1",
        scenario_id=scenario_id,
        session_id=f"{bot_id}-session",
        config=config or {},
        started_at=datetime(2026, 4, 21, 10, 0, 0, tzinfo=UTC),
    )


def test_runner_service_registers_seeded_formula_bots() -> None:
    service = RunnerService("http://core", "http://data")

    assert ("baseline-roundtrip", "v1") in service._executors
    assert ("buy-and-hold", "v1") in service._executors
    assert ("moving-average-cross", "v1") in service._executors


def test_buy_and_hold_executor_publishes_single_entry_per_symbol() -> None:
    service = SpyRunnerService()
    payload = make_payload(
        "buy-and-hold",
        scenario_id="trend-up",
        config={"trade_notional": 750, "tick_interval_ms": 0},
    )
    ticks = [
        make_tick("BTCUSDT", 100, 0),
        make_tick("BTCUSDT", 110, 1),
        make_tick("ETHUSDT", 50, 2),
        make_tick("ETHUSDT", 55, 3),
    ]

    status = asyncio.run(
        service._run_buy_and_hold_v1(None, payload, ticks, asyncio.Event())  # type: ignore[arg-type]
    )

    assert status == "completed"
    assert [tick.symbol for tick in service.published_ticks] == ["BTCUSDT", "BTCUSDT", "ETHUSDT", "ETHUSDT"]
    assert [signal.symbol for signal in service.published_signals] == ["BTCUSDT", "ETHUSDT"]
    assert all(signal.side == "buy" for signal in service.published_signals)
    assert all(signal.notional == 750 for signal in service.published_signals)
    assert service.published_signals[0].signal_id.endswith("btcusdt-hold-entry")
    assert service.published_signals[1].signal_id.endswith("ethusdt-hold-entry")


def test_moving_average_cross_executor_emits_entry_and_exit() -> None:
    service = SpyRunnerService()
    payload = make_payload(
        "moving-average-cross",
        scenario_id="range-chop",
        config={"trade_notional": 300, "tick_interval_ms": 0, "fast_window": 2, "slow_window": 3},
    )
    ticks = [
        make_tick("BTCUSDT", 100, 0),
        make_tick("BTCUSDT", 90, 1),
        make_tick("BTCUSDT", 110, 2),
        make_tick("BTCUSDT", 120, 3),
        make_tick("BTCUSDT", 80, 4),
    ]

    status = asyncio.run(
        service._run_moving_average_cross_v1(None, payload, ticks, asyncio.Event())  # type: ignore[arg-type]
    )

    assert status == "completed"
    assert len(service.published_signals) == 2
    assert service.published_signals[0].side == "buy"
    assert service.published_signals[0].notional == 300
    assert service.published_signals[0].signal_id.endswith("ma-entry-1")
    assert service.published_signals[1].side == "sell"
    assert service.published_signals[1].quantity == 2.5
    assert service.published_signals[1].signal_id.endswith("ma-exit-2")


def test_moving_average_cross_rejects_invalid_windows() -> None:
    service = SpyRunnerService()
    payload = make_payload(
        "moving-average-cross",
        scenario_id="range-chop",
        config={"trade_notional": 300, "tick_interval_ms": 0, "fast_window": 3, "slow_window": 3},
    )
    ticks = [
        make_tick("BTCUSDT", 100, 0),
        make_tick("BTCUSDT", 90, 1),
        make_tick("BTCUSDT", 110, 2),
    ]

    try:
        asyncio.run(
            service._run_moving_average_cross_v1(None, payload, ticks, asyncio.Event())  # type: ignore[arg-type]
        )
    except ValueError as exc:
        assert str(exc) == "invalid moving-average config"
    else:
        raise AssertionError("expected invalid moving-average config error")
