import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import logging
from typing import Awaitable, Callable

import httpx

from app.schemas.runner import ReplayTick, StartRunRequest


logger = logging.getLogger("bot_runner.runner")
logger.setLevel(logging.INFO)


@dataclass(frozen=True)
class SignalEnvelope:
    symbol: str
    side: str
    quantity: float
    notional: float
    price_hint: float
    signal_id: str
    strategy_id: str
    run_id: str
    bot_id: str
    bot_version: str
    timestamp: str


BotExecutor = Callable[
    [httpx.AsyncClient, StartRunRequest, list[ReplayTick], asyncio.Event],
    Awaitable[str],
]

_CORE_PUBLISH_MAX_ATTEMPTS = 3
_CORE_PUBLISH_RETRY_DELAY_SECONDS = 0.05


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _run_context(payload: StartRunRequest) -> dict[str, object]:
    return {
        "bot_id": payload.bot_id,
        "bot_version": payload.bot_version,
        "run_id": payload.run_id,
        "scenario_id": payload.scenario_id,
        "session_id": payload.session_id,
    }


def _log_event(level: str, event: str, **fields: object) -> None:
    payload = {
        "event": event,
        "level": level,
        "service": "bot_runner",
        "timestamp": _utc_now(),
        **fields,
    }
    message = json.dumps(payload, sort_keys=True)

    if level == "error":
        logger.error(message)
        return

    if level == "warning":
        logger.warning(message)
        return

    logger.info(message)


class RunnerService:
    def __init__(
        self,
        core_trading_base_url: str,
        data_pipeline_base_url: str,
        request_timeout_seconds: float = 5.0,
    ) -> None:
        self._core_trading_base_url = core_trading_base_url.rstrip("/")
        self._data_pipeline_base_url = data_pipeline_base_url.rstrip("/")
        self._timeout = request_timeout_seconds
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._stop_events: dict[str, asyncio.Event] = {}
        self._executors: dict[tuple[str, str], BotExecutor] = {
            ("baseline-roundtrip", "v1"): self._run_baseline_roundtrip_v1,
            ("buy-and-hold", "v1"): self._run_buy_and_hold_v1,
            ("moving-average-cross", "v1"): self._run_moving_average_cross_v1,
        }

    def active_run_count(self) -> int:
        return sum(0 if task.done() else 1 for task in self._tasks.values())

    async def start_run(self, payload: StartRunRequest) -> None:
        _log_event("info", "run_start_requested", **_run_context(payload))
        if (payload.bot_id, payload.bot_version) not in self._executors:
            _log_event(
                "warning",
                "run_rejected",
                reason="unsupported_bot_version",
                **_run_context(payload),
            )
            raise ValueError("unsupported bot version")
        if payload.run_id in self._tasks and not self._tasks[payload.run_id].done():
            _log_event(
                "warning",
                "run_rejected",
                reason="run_already_active",
                **_run_context(payload),
            )
            raise ValueError("run already active")
        try:
            self._validate_bot_config(payload)
        except ValueError as exc:
            _log_event("warning", "run_rejected", reason=str(exc), **_run_context(payload))
            raise

        ticks = await self._load_replay_ticks(payload.scenario_id)
        if not ticks:
            _log_event(
                "warning",
                "run_rejected",
                reason="empty_replay_ticks",
                **_run_context(payload),
            )
            raise ValueError("scenario returned no replay ticks")
        try:
            self._validate_replay_ticks(ticks)
        except ValueError as exc:
            _log_event("warning", "run_rejected", reason=str(exc), **_run_context(payload))
            raise

        stop_event = asyncio.Event()
        task = asyncio.create_task(self._execute_run(payload, ticks, stop_event))
        self._stop_events[payload.run_id] = stop_event
        self._tasks[payload.run_id] = task
        _log_event(
            "info",
            "run_accepted",
            active_run_count=self.active_run_count(),
            replay_tick_count=len(ticks),
            **_run_context(payload),
        )

    async def stop_run(self, run_id: str) -> None:
        stop_event = self._stop_events.get(run_id)
        if stop_event is None:
            _log_event(
                "warning",
                "run_stop_rejected",
                reason="run_not_found",
                run_id=run_id,
            )
            raise KeyError(run_id)

        stop_event.set()
        _log_event("info", "run_stop_requested", run_id=run_id)

    async def _execute_run(
        self,
        payload: StartRunRequest,
        ticks: list[ReplayTick],
        stop_event: asyncio.Event,
    ) -> None:
        _log_event(
            "info",
            "run_execution_started",
            replay_tick_count=len(ticks),
            **_run_context(payload),
        )
        try:
            executor = self._executors[(payload.bot_id, payload.bot_version)]
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                await self._notify_status(client, payload.run_id, "running")
                await self._notify_heartbeat(client, payload.run_id)
                final_status = await executor(client, payload, ticks, stop_event)
                await self._notify_status(client, payload.run_id, final_status)
                _log_event(
                    "info",
                    "run_execution_finished",
                    status=final_status,
                    **_run_context(payload),
                )
        except Exception as exc:
            _log_event(
                "error",
                "run_execution_failed",
                error_message=str(exc),
                error_type=type(exc).__name__,
                **_run_context(payload),
            )
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    await self._notify_status(
                        client,
                        payload.run_id,
                        "failed",
                        error_message=str(exc),
                    )
            finally:
                self._stop_events.pop(payload.run_id, None)
                self._tasks.pop(payload.run_id, None)
            return

        self._stop_events.pop(payload.run_id, None)
        self._tasks.pop(payload.run_id, None)

    async def _run_baseline_roundtrip_v1(
        self,
        client: httpx.AsyncClient,
        payload: StartRunRequest,
        ticks: list[ReplayTick],
        stop_event: asyncio.Event,
    ) -> str:
        by_symbol: dict[str, list[int]] = defaultdict(list)
        for index, tick in enumerate(ticks):
            by_symbol[tick.symbol].append(index)

        entry_index = {symbol: indices[0] for symbol, indices in by_symbol.items()}
        exit_index = {
            symbol: indices[-1]
            for symbol, indices in by_symbol.items()
            if len(indices) > 1
        }
        trade_notional = float(payload.config.get("trade_notional", 1000))
        tick_interval_ms = int(payload.config.get("tick_interval_ms", 250))
        holdings: dict[str, float] = {}

        for index, tick in enumerate(ticks):
            if stop_event.is_set():
                return "stopped"

            await self._publish_tick(client, tick)
            await self._notify_heartbeat(client, payload.run_id)
            if stop_event.is_set():
                return "stopped"

            if entry_index.get(tick.symbol) == index and tick.symbol in exit_index:
                quantity = trade_notional / tick.price
                holdings[tick.symbol] = quantity
                await self._publish_signal(
                    client,
                    self._make_signal(
                        payload,
                        tick,
                        side="buy",
                        signal_id=f"{payload.run_id}-{tick.symbol.lower()}-entry",
                        notional=trade_notional,
                    ),
                )

            if exit_index.get(tick.symbol) == index and holdings.get(tick.symbol, 0) > 0:
                await self._publish_signal(
                    client,
                    self._make_signal(
                        payload,
                        tick,
                        side="sell",
                        signal_id=f"{payload.run_id}-{tick.symbol.lower()}-exit",
                        quantity=holdings[tick.symbol],
                    ),
                )
                holdings[tick.symbol] = 0.0

            if await self._sleep_or_stop(stop_event, tick_interval_ms, index, len(ticks)):
                return "stopped"

        return "completed"

    async def _run_buy_and_hold_v1(
        self,
        client: httpx.AsyncClient,
        payload: StartRunRequest,
        ticks: list[ReplayTick],
        stop_event: asyncio.Event,
    ) -> str:
        entry_index: dict[str, int] = {}
        for index, tick in enumerate(ticks):
            entry_index.setdefault(tick.symbol, index)

        trade_notional = float(payload.config.get("trade_notional", 1000))
        tick_interval_ms = int(payload.config.get("tick_interval_ms", 250))

        for index, tick in enumerate(ticks):
            if stop_event.is_set():
                return "stopped"

            await self._publish_tick(client, tick)
            await self._notify_heartbeat(client, payload.run_id)
            if stop_event.is_set():
                return "stopped"

            if entry_index.get(tick.symbol) == index:
                await self._publish_signal(
                    client,
                    self._make_signal(
                        payload,
                        tick,
                        side="buy",
                        signal_id=f"{payload.run_id}-{tick.symbol.lower()}-hold-entry",
                        notional=trade_notional,
                    ),
                )

            if await self._sleep_or_stop(stop_event, tick_interval_ms, index, len(ticks)):
                return "stopped"

        return "completed"

    async def _run_moving_average_cross_v1(
        self,
        client: httpx.AsyncClient,
        payload: StartRunRequest,
        ticks: list[ReplayTick],
        stop_event: asyncio.Event,
    ) -> str:
        trade_notional = float(payload.config.get("trade_notional", 1000))
        tick_interval_ms = int(payload.config.get("tick_interval_ms", 250))
        fast_window = int(payload.config.get("fast_window", 2))
        slow_window = int(payload.config.get("slow_window", 3))
        if fast_window < 2 or slow_window <= fast_window:
            raise ValueError("invalid moving-average config")

        price_history: dict[str, list[float]] = defaultdict(list)
        holdings: dict[str, float] = {}
        last_above: dict[str, bool] = {}
        trade_sequence: dict[str, int] = defaultdict(int)
        final_index_by_symbol: dict[str, int] = {}
        for index, tick in enumerate(ticks):
            final_index_by_symbol[tick.symbol] = index

        for index, tick in enumerate(ticks):
            if stop_event.is_set():
                return "stopped"

            await self._publish_tick(client, tick)
            await self._notify_heartbeat(client, payload.run_id)
            if stop_event.is_set():
                return "stopped"

            prices = price_history[tick.symbol]
            prices.append(tick.price)
            if len(prices) >= slow_window:
                fast_average = sum(prices[-fast_window:]) / fast_window
                slow_average = sum(prices[-slow_window:]) / slow_window
                is_above = fast_average > slow_average
                previous = last_above.get(tick.symbol)

                if previous is False and is_above and holdings.get(tick.symbol, 0) <= 0:
                    holdings[tick.symbol] = trade_notional / tick.price
                    trade_sequence[tick.symbol] += 1
                    await self._publish_signal(
                        client,
                        self._make_signal(
                            payload,
                            tick,
                            side="buy",
                            signal_id=f"{payload.run_id}-{tick.symbol.lower()}-ma-entry-{trade_sequence[tick.symbol]}",
                            notional=trade_notional,
                        ),
                    )

                if previous is True and not is_above and holdings.get(tick.symbol, 0) > 0:
                    trade_sequence[tick.symbol] += 1
                    await self._publish_signal(
                        client,
                        self._make_signal(
                            payload,
                            tick,
                            side="sell",
                            signal_id=f"{payload.run_id}-{tick.symbol.lower()}-ma-exit-{trade_sequence[tick.symbol]}",
                            quantity=holdings[tick.symbol],
                        ),
                    )
                    holdings[tick.symbol] = 0.0

                last_above[tick.symbol] = is_above

            if final_index_by_symbol.get(tick.symbol) == index and holdings.get(tick.symbol, 0) > 0:
                trade_sequence[tick.symbol] += 1
                await self._publish_signal(
                    client,
                    self._make_signal(
                        payload,
                        tick,
                        side="sell",
                        signal_id=f"{payload.run_id}-{tick.symbol.lower()}-ma-close-{trade_sequence[tick.symbol]}",
                        quantity=holdings[tick.symbol],
                    ),
                )
                holdings[tick.symbol] = 0.0

            if await self._sleep_or_stop(stop_event, tick_interval_ms, index, len(ticks)):
                return "stopped"

        return "completed"

    async def _load_replay_ticks(self, scenario_id: str) -> list[ReplayTick]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(
                f"{self._data_pipeline_base_url}/api/data/market/quotes/replay",
                params={"scenario": scenario_id},
            )
            response.raise_for_status()
            payload = response.json()

        return [ReplayTick.model_validate(item) for item in payload.get("ticks", [])]

    def _validate_bot_config(self, payload: StartRunRequest) -> None:
        trade_notional = float(payload.config.get("trade_notional", 1000))
        if trade_notional <= 0:
            raise ValueError("trade_notional must be greater than 0")

        tick_interval_ms = int(payload.config.get("tick_interval_ms", 250))
        if tick_interval_ms < 0:
            raise ValueError("tick_interval_ms must be greater than or equal to 0")

        if (payload.bot_id, payload.bot_version) == ("moving-average-cross", "v1"):
            fast_window = int(payload.config.get("fast_window", 2))
            slow_window = int(payload.config.get("slow_window", 3))
            if fast_window < 2 or slow_window <= fast_window:
                raise ValueError("invalid moving-average config")

    def _validate_replay_ticks(self, ticks: list[ReplayTick]) -> None:
        previous_tick = ticks[0]
        for tick in ticks[1:]:
            if (tick.timestamp, tick.symbol) < (previous_tick.timestamp, previous_tick.symbol):
                raise ValueError("replay ticks must be sorted by timestamp and symbol")
            previous_tick = tick

    async def _publish_tick(self, client: httpx.AsyncClient, tick: ReplayTick) -> None:
        await self._post_core_json_with_retry(
            client,
            f"{self._core_trading_base_url}/internal/market/prices",
            {
                "ticks": [
                    {
                        "symbol": tick.symbol,
                        "price": tick.price,
                        "source": tick.source,
                        "timestamp": tick.timestamp.isoformat().replace("+00:00", "Z"),
                    }
                ]
            },
        )

    async def _publish_signal(self, client: httpx.AsyncClient, signal: SignalEnvelope) -> None:
        self._validate_signal_envelope(signal)
        await self._post_core_json_with_retry(
            client,
            f"{self._core_trading_base_url}/internal/signals",
            {
                "strategy_id": signal.strategy_id,
                "signal_id": signal.signal_id,
                "run_id": signal.run_id,
                "bot_id": signal.bot_id,
                "bot_version": signal.bot_version,
                "symbol": signal.symbol,
                "side": signal.side,
                "quantity": signal.quantity,
                "notional": signal.notional,
                "price_hint": signal.price_hint,
                "timestamp": signal.timestamp,
            },
        )
        _log_event(
            "info",
            "signal_published",
            bot_id=signal.bot_id,
            bot_version=signal.bot_version,
            run_id=signal.run_id,
            signal_id=signal.signal_id,
            side=signal.side,
            strategy_id=signal.strategy_id,
            symbol=signal.symbol,
        )

    async def _post_core_json_with_retry(
        self,
        client: httpx.AsyncClient,
        url: str,
        payload: dict[str, object],
    ) -> None:
        for attempt in range(1, _CORE_PUBLISH_MAX_ATTEMPTS + 1):
            try:
                response = await client.post(url, json=payload)
            except httpx.TransportError:
                if attempt >= _CORE_PUBLISH_MAX_ATTEMPTS:
                    raise
                await asyncio.sleep(_CORE_PUBLISH_RETRY_DELAY_SECONDS * attempt)
                continue

            if response.status_code >= 500 and attempt < _CORE_PUBLISH_MAX_ATTEMPTS:
                await asyncio.sleep(_CORE_PUBLISH_RETRY_DELAY_SECONDS * attempt)
                continue

            response.raise_for_status()
            return
        response.raise_for_status()

    def _make_signal(
        self,
        payload: StartRunRequest,
        tick: ReplayTick,
        *,
        side: str,
        signal_id: str,
        quantity: float = 0.0,
        notional: float = 0.0,
    ) -> SignalEnvelope:
        signal = SignalEnvelope(
            symbol=tick.symbol,
            side=side,
            quantity=quantity,
            notional=notional,
            price_hint=tick.price,
            signal_id=signal_id,
            strategy_id=payload.bot_id,
            run_id=payload.run_id,
            bot_id=payload.bot_id,
            bot_version=payload.bot_version,
            timestamp=tick.timestamp.isoformat().replace("+00:00", "Z"),
        )
        self._validate_signal_envelope(signal)
        return signal

    def _validate_signal_envelope(self, signal: SignalEnvelope) -> None:
        if signal.side not in {"buy", "sell"}:
            raise ValueError("signal side must be buy or sell")
        if not signal.symbol.strip():
            raise ValueError("signal symbol is required")
        if not signal.signal_id.strip():
            raise ValueError("signal_id is required")
        if not signal.strategy_id.strip() or not signal.run_id.strip():
            raise ValueError("signal strategy_id and run_id are required")
        if signal.quantity < 0 or signal.notional < 0:
            raise ValueError("signal quantity and notional must be non-negative")
        if (signal.quantity > 0) == (signal.notional > 0):
            raise ValueError("signal must set exactly one of quantity or notional")
        if signal.price_hint <= 0:
            raise ValueError("signal price_hint must be greater than 0")
        if not signal.timestamp.strip():
            raise ValueError("signal timestamp is required")

    async def _sleep_or_stop(
        self,
        stop_event: asyncio.Event,
        tick_interval_ms: int,
        index: int,
        total_ticks: int,
    ) -> bool:
        if tick_interval_ms <= 0 or index >= total_ticks - 1:
            return False

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=tick_interval_ms / 1000)
            return True
        except TimeoutError:
            return False

    async def _notify_status(
        self,
        client: httpx.AsyncClient,
        run_id: str,
        status: str,
        error_message: str = "",
    ) -> None:
        response = await client.post(
            f"{self._core_trading_base_url}/internal/sim/runs/{run_id}/status",
            json={
                "status": status,
                "error_message": error_message,
            },
        )
        response.raise_for_status()
        _log_event(
            "info",
            "status_callback_sent",
            has_error=bool(error_message),
            run_id=run_id,
            status=status,
        )

    async def _notify_heartbeat(
        self,
        client: httpx.AsyncClient,
        run_id: str,
    ) -> None:
        response = await client.post(
            f"{self._core_trading_base_url}/internal/sim/runs/{run_id}/heartbeat",
            json={},
        )
        response.raise_for_status()
