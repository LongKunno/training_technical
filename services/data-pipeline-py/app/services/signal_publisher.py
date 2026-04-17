from dataclasses import dataclass

import httpx

from app.schemas.strategy import StrategySignal


@dataclass(frozen=True)
class SignalPublishResult:
    published_count: int
    signal_ids: list[str]
    strategy_ids: list[str]
    transports: list[str]


class SignalPublisher:
    def __init__(self, core_trading_internal_base_url: str) -> None:
        self._core_trading_internal_base_url = core_trading_internal_base_url.rstrip("/")

    async def publish_signals(self, signals: list[StrategySignal]) -> SignalPublishResult:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for signal in signals:
                response = await client.post(
                    f"{self._core_trading_internal_base_url}/internal/signals",
                    json=signal.model_dump(mode="json", exclude={"scenario"}),
                )
                response.raise_for_status()

        return SignalPublishResult(
            published_count=len(signals),
            signal_ids=[signal.signal_id for signal in signals],
            strategy_ids=sorted({signal.strategy_id for signal in signals}),
            transports=["http"],
        )
