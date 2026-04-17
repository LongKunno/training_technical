import json
from pathlib import Path

from app.schemas.strategy import StrategySignal


class MockStrategySignalService:
    def __init__(self, fixture_path: str) -> None:
        self._fixture_path = Path(fixture_path)
        self._signals = self._load_signals()

    def scenarios(self) -> list[str]:
        return sorted({signal.scenario for signal in self._signals})

    def list_signals(
        self,
        scenario: str = "baseline",
        strategy_id: str | None = None,
        limit: int = 0,
        offset: int = 0,
    ) -> list[StrategySignal]:
        signals = self._filter_signals(scenario=scenario, strategy_id=strategy_id)
        if offset < 0:
            offset = 0
        if offset >= len(signals):
            return []
        if limit <= 0:
            return signals[offset:]

        return signals[offset : offset + limit]

    def replay_signals(
        self,
        scenario: str = "baseline",
        strategy_id: str | None = None,
    ) -> list[StrategySignal]:
        return self._filter_signals(scenario=scenario, strategy_id=strategy_id)

    def _load_signals(self) -> list[StrategySignal]:
        payload = json.loads(self._fixture_path.read_text(encoding="utf-8"))
        return [StrategySignal.model_validate(item) for item in payload]

    def _filter_signals(
        self,
        scenario: str,
        strategy_id: str | None,
    ) -> list[StrategySignal]:
        signals = [signal for signal in self._signals if signal.scenario == scenario]
        if strategy_id:
            signals = [signal for signal in signals if signal.strategy_id == strategy_id]

        return sorted(signals, key=lambda signal: (signal.timestamp, signal.signal_id))
