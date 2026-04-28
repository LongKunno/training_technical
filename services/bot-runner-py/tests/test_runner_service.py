import asyncio
from datetime import UTC, datetime
import json
import logging

import httpx

from app.schemas.runner import ReplayTick, StartRunRequest
from app.services.runner_service import RunnerService, SignalEnvelope


class SpyRunnerService(RunnerService):
    def __init__(self) -> None:
        super().__init__("http://core", "http://data", request_timeout_seconds=0.1)
        self.published_ticks: list[ReplayTick] = []
        self.published_signals: list[SignalEnvelope] = []
        self.heartbeats: list[str] = []
        self.replay_ticks: list[ReplayTick] = []
        self.status_updates: list[tuple[str, str, str]] = []

    async def _load_replay_ticks(self, scenario_id: str) -> list[ReplayTick]:  # type: ignore[override]
        return self.replay_ticks

    async def _publish_tick(self, client, tick: ReplayTick) -> None:  # type: ignore[override]
        self.published_ticks.append(tick)

    async def _publish_signal(self, client, signal: SignalEnvelope) -> None:  # type: ignore[override]
        self.published_signals.append(signal)

    async def _notify_heartbeat(self, client, run_id: str) -> None:  # type: ignore[override]
        self.heartbeats.append(run_id)

    async def _notify_status(  # type: ignore[override]
        self,
        client,
        run_id: str,
        status: str,
        error_message: str = "",
    ) -> None:
        self.status_updates.append((run_id, status, error_message))


class StopAfterHeartbeatRunnerService(SpyRunnerService):
    def __init__(self, stop_event: asyncio.Event) -> None:
        super().__init__()
        self.stop_event = stop_event

    async def _notify_heartbeat(self, client, run_id: str) -> None:  # type: ignore[override]
        await super()._notify_heartbeat(client, run_id)
        self.stop_event.set()


class RetryResponse:
    def __init__(self, status_code: int, url: str) -> None:
        self.status_code = status_code
        self._request = httpx.Request("POST", url)
        self._response = httpx.Response(status_code, request=self._request)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"status {self.status_code}",
                request=self._request,
                response=self._response,
            )


class SequencedPostClient:
    def __init__(self, outcomes: list[int | httpx.TransportError]) -> None:
        self.outcomes = outcomes
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def post(self, url: str, json: dict[str, object]) -> RetryResponse:
        self.calls.append((url, json))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, httpx.TransportError):
            raise outcome
        return RetryResponse(outcome, url)


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


def runner_log_payloads(caplog) -> list[dict[str, object]]:
    payloads: list[dict[str, object]] = []
    for record in caplog.records:
        if record.name != "bot_runner.runner":
            continue
        payloads.append(json.loads(record.message))
    return payloads


def test_runner_service_registers_seeded_formula_bots() -> None:
    service = RunnerService("http://core", "http://data")

    assert ("baseline-roundtrip", "v1") in service._executors
    assert ("buy-and-hold", "v1") in service._executors
    assert ("moving-average-cross", "v1") in service._executors


def test_start_run_logs_structured_lifecycle_context(caplog) -> None:
    async def run_scenario() -> SpyRunnerService:
        service = SpyRunnerService()
        payload = make_payload(
            "buy-and-hold",
            scenario_id="trend-up",
            config={"trade_notional": 750, "tick_interval_ms": 0},
        )
        service.replay_ticks = [
            make_tick("BTCUSDT", 100, 0),
            make_tick("BTCUSDT", 110, 1),
        ]

        await service.start_run(payload)
        task = service._tasks[payload.run_id]
        await asyncio.wait_for(task, timeout=1)
        return service

    caplog.set_level(logging.INFO, logger="bot_runner.runner")

    service = asyncio.run(run_scenario())
    payloads = runner_log_payloads(caplog)
    events = [payload["event"] for payload in payloads]

    assert events == [
        "run_start_requested",
        "run_accepted",
        "run_execution_started",
        "run_execution_finished",
    ]
    assert payloads[0]["run_id"] == "buy-and-hold-run"
    assert payloads[0]["session_id"] == "buy-and-hold-session"
    assert payloads[0]["scenario_id"] == "trend-up"
    assert payloads[0]["bot_id"] == "buy-and-hold"
    assert payloads[1]["replay_tick_count"] == 2
    assert payloads[-1]["status"] == "completed"
    assert service.active_run_count() == 0


def test_core_publish_logs_signal_and_status_callbacks(caplog) -> None:
    service = RunnerService("http://core", "http://data")
    payload = make_payload("buy-and-hold")
    signal = service._make_signal(
        payload,
        make_tick("BTCUSDT", 100, 0),
        side="buy",
        signal_id="signal-1",
        notional=100,
    )
    signal_client = SequencedPostClient([200])
    status_client = SequencedPostClient([200])

    caplog.set_level(logging.INFO, logger="bot_runner.runner")

    asyncio.run(service._publish_signal(signal_client, signal))  # type: ignore[arg-type]
    asyncio.run(
        service._notify_status(  # type: ignore[arg-type]
            status_client,
            payload.run_id,
            "failed",
            error_message="synthetic failure",
        )
    )

    payloads = runner_log_payloads(caplog)

    assert payloads[0]["event"] == "signal_published"
    assert payloads[0]["run_id"] == "buy-and-hold-run"
    assert payloads[0]["signal_id"] == "signal-1"
    assert payloads[0]["symbol"] == "BTCUSDT"
    assert payloads[1]["event"] == "status_callback_sent"
    assert payloads[1]["run_id"] == "buy-and-hold-run"
    assert payloads[1]["status"] == "failed"
    assert payloads[1]["has_error"] is True


def test_start_run_rejects_out_of_order_replay_ticks_before_publishing() -> None:
    async def run_scenario() -> SpyRunnerService:
        service = SpyRunnerService()
        payload = make_payload(
            "buy-and-hold",
            scenario_id="trend-up",
            config={"trade_notional": 750, "tick_interval_ms": 0},
        )
        service.replay_ticks = [
            make_tick("BTCUSDT", 110, 1),
            make_tick("BTCUSDT", 100, 0),
        ]

        try:
            await service.start_run(payload)
        except ValueError as exc:
            assert str(exc) == "replay ticks must be sorted by timestamp and symbol"
        else:
            raise AssertionError("expected replay ordering validation error")

        return service

    service = asyncio.run(run_scenario())

    assert service.published_ticks == []
    assert service.published_signals == []
    assert service.status_updates == []
    assert service.active_run_count() == 0


def test_start_run_rejects_invalid_bot_config_before_loading_replay() -> None:
    async def run_scenario() -> SpyRunnerService:
        service = SpyRunnerService()
        payload = make_payload(
            "moving-average-cross",
            scenario_id="range-chop",
            config={"trade_notional": 300, "tick_interval_ms": 0, "fast_window": 3, "slow_window": 3},
        )
        service.replay_ticks = []

        try:
            await service.start_run(payload)
        except ValueError as exc:
            assert str(exc) == "invalid moving-average config"
        else:
            raise AssertionError("expected bot config validation error")

        return service

    service = asyncio.run(run_scenario())

    assert service.published_ticks == []
    assert service.published_signals == []
    assert service.status_updates == []
    assert service.active_run_count() == 0


def test_start_run_rejects_negative_trade_notional_before_publishing() -> None:
    async def run_scenario() -> SpyRunnerService:
        service = SpyRunnerService()
        payload = make_payload(
            "buy-and-hold",
            scenario_id="trend-up",
            config={"trade_notional": -1, "tick_interval_ms": 0},
        )

        try:
            await service.start_run(payload)
        except ValueError as exc:
            assert str(exc) == "trade_notional must be greater than 0"
        else:
            raise AssertionError("expected trade_notional validation error")

        return service

    service = asyncio.run(run_scenario())

    assert service.published_ticks == []
    assert service.published_signals == []
    assert service.status_updates == []
    assert service.active_run_count() == 0


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


def test_publish_tick_retries_transient_core_status() -> None:
    service = RunnerService("http://core", "http://data")
    client = SequencedPostClient([503, 200])

    asyncio.run(
        service._publish_tick(  # type: ignore[arg-type]
            client,
            make_tick("BTCUSDT", 100, 0),
        )
    )

    assert [url for url, _ in client.calls] == [
        "http://core/internal/market/prices",
        "http://core/internal/market/prices",
    ]


def test_publish_signal_retries_transient_transport_error() -> None:
    service = RunnerService("http://core", "http://data")
    request = httpx.Request("POST", "http://core/internal/signals")
    client = SequencedPostClient([httpx.ConnectError("connection reset", request=request), 200])
    payload = make_payload("buy-and-hold")
    signal = service._make_signal(
        payload,
        make_tick("BTCUSDT", 100, 0),
        side="buy",
        signal_id="signal-1",
        notional=100,
    )

    asyncio.run(service._publish_signal(client, signal))  # type: ignore[arg-type]

    assert [url for url, _ in client.calls] == [
        "http://core/internal/signals",
        "http://core/internal/signals",
    ]


def test_publish_signal_does_not_retry_contract_error() -> None:
    service = RunnerService("http://core", "http://data")
    client = SequencedPostClient([400, 200])
    payload = make_payload("buy-and-hold")
    signal = service._make_signal(
        payload,
        make_tick("BTCUSDT", 100, 0),
        side="buy",
        signal_id="signal-1",
        notional=100,
    )

    try:
        asyncio.run(service._publish_signal(client, signal))  # type: ignore[arg-type]
    except httpx.HTTPStatusError as exc:
        assert exc.response.status_code == 400
    else:
        raise AssertionError("expected non-retryable contract error")

    assert [url for url, _ in client.calls] == ["http://core/internal/signals"]


def test_make_signal_rejects_invalid_side() -> None:
    service = RunnerService("http://core", "http://data")
    payload = make_payload("buy-and-hold")

    try:
        service._make_signal(
            payload,
            make_tick("BTCUSDT", 100, 0),
            side="hold",
            signal_id="signal-1",
            notional=100,
        )
    except ValueError as exc:
        assert str(exc) == "signal side must be buy or sell"
    else:
        raise AssertionError("expected invalid signal side")


def test_make_signal_rejects_ambiguous_sizing() -> None:
    service = RunnerService("http://core", "http://data")
    payload = make_payload("buy-and-hold")

    for quantity, notional in [(0.0, 0.0), (1.0, 100.0)]:
        try:
            service._make_signal(
                payload,
                make_tick("BTCUSDT", 100, 0),
                side="buy",
                signal_id=f"signal-{quantity}-{notional}",
                quantity=quantity,
                notional=notional,
            )
        except ValueError as exc:
            assert str(exc) == "signal must set exactly one of quantity or notional"
        else:
            raise AssertionError("expected invalid signal sizing")


def test_publish_signal_validates_envelope_before_core_call() -> None:
    service = RunnerService("http://core", "http://data")
    client = SequencedPostClient([200])
    signal = SignalEnvelope(
        symbol="BTCUSDT",
        side="buy",
        quantity=-1,
        notional=0,
        price_hint=100,
        signal_id="signal-1",
        strategy_id="buy-and-hold",
        run_id="run-1",
        bot_id="buy-and-hold",
        bot_version="v1",
        timestamp="2026-04-21T10:00:00Z",
    )

    try:
        asyncio.run(service._publish_signal(client, signal))  # type: ignore[arg-type]
    except ValueError as exc:
        assert str(exc) == "signal quantity and notional must be non-negative"
    else:
        raise AssertionError("expected invalid signal envelope")

    assert client.calls == []


def test_stop_run_cancels_active_executor_and_reports_stopped() -> None:
    async def run_scenario() -> SpyRunnerService:
        service = SpyRunnerService()
        payload = make_payload(
            "buy-and-hold",
            scenario_id="trend-up",
            config={"trade_notional": 750, "tick_interval_ms": 5000},
        )
        service.replay_ticks = [
            make_tick("BTCUSDT", 100, 0),
            make_tick("BTCUSDT", 110, 1),
        ]

        await service.start_run(payload)
        task = service._tasks[payload.run_id]

        for _ in range(20):
            if service.published_ticks:
                break
            await asyncio.sleep(0.01)

        assert len(service.published_ticks) == 1
        await service.stop_run(payload.run_id)
        await asyncio.wait_for(task, timeout=1)
        return service

    service = asyncio.run(run_scenario())

    assert [status for _, status, _ in service.status_updates] == ["running", "stopped"]
    assert [tick.price for tick in service.published_ticks] == [100]
    assert [signal.signal_id for signal in service.published_signals] == [
        "buy-and-hold-run-btcusdt-hold-entry"
    ]
    assert service.heartbeats == ["buy-and-hold-run", "buy-and-hold-run"]
    assert service.active_run_count() == 0


def test_executor_does_not_publish_signal_after_stop_is_set_post_heartbeat() -> None:
    stop_event = asyncio.Event()
    service = StopAfterHeartbeatRunnerService(stop_event)
    payload = make_payload(
        "buy-and-hold",
        scenario_id="trend-up",
        config={"trade_notional": 750, "tick_interval_ms": 0},
    )
    ticks = [
        make_tick("BTCUSDT", 100, 0),
        make_tick("BTCUSDT", 110, 1),
    ]

    status = asyncio.run(
        service._run_buy_and_hold_v1(None, payload, ticks, stop_event)  # type: ignore[arg-type]
    )

    assert status == "stopped"
    assert [tick.price for tick in service.published_ticks] == [100]
    assert service.heartbeats == ["buy-and-hold-run"]
    assert service.published_signals == []


def test_executor_failure_reports_failed_status_and_cleans_task() -> None:
    async def failing_executor(*_args) -> str:
        raise RuntimeError("synthetic executor failure")

    async def run_scenario() -> SpyRunnerService:
        service = SpyRunnerService()
        service._executors[("failing-bot", "v1")] = failing_executor
        payload = make_payload(
            "failing-bot",
            scenario_id="range-chop",
            config={"trade_notional": 300, "tick_interval_ms": 0},
        )
        service.replay_ticks = [
            make_tick("BTCUSDT", 100, 0),
            make_tick("BTCUSDT", 90, 1),
            make_tick("BTCUSDT", 110, 2),
        ]

        await service.start_run(payload)
        task = service._tasks[payload.run_id]
        await asyncio.wait_for(task, timeout=1)
        return service

    service = asyncio.run(run_scenario())

    assert [status for _, status, _ in service.status_updates] == ["running", "failed"]
    assert service.status_updates[-1][2] == "synthetic executor failure"
    assert service.heartbeats == ["failing-bot-run"]
    assert service.active_run_count() == 0


def test_start_run_sends_heartbeat_before_and_during_replay() -> None:
    async def run_scenario() -> SpyRunnerService:
        service = SpyRunnerService()
        payload = make_payload(
            "buy-and-hold",
            scenario_id="trend-up",
            config={"trade_notional": 750, "tick_interval_ms": 0},
        )
        service.replay_ticks = [
            make_tick("BTCUSDT", 100, 0),
            make_tick("BTCUSDT", 110, 1),
            make_tick("ETHUSDT", 50, 2),
        ]

        await service.start_run(payload)
        task = service._tasks[payload.run_id]
        await asyncio.wait_for(task, timeout=1)
        return service

    service = asyncio.run(run_scenario())

    assert [status for _, status, _ in service.status_updates] == ["running", "completed"]
    assert service.heartbeats == [
        "buy-and-hold-run",
        "buy-and-hold-run",
        "buy-and-hold-run",
        "buy-and-hold-run",
    ]
    assert [tick.price for tick in service.published_ticks] == [100, 110, 50]
    assert service.active_run_count() == 0
