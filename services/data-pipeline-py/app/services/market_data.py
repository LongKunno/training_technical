import json
from pathlib import Path

from app.schemas.market import PriceTick


class MockMarketDataService:
    def __init__(self, fixture_path: str) -> None:
        self._fixture_path = Path(fixture_path)
        self._ticks = self._load_ticks()

    def latest_quote(self, symbol: str, scenario: str = "baseline") -> PriceTick:
        symbol_ticks = [tick for tick in self._filter_ticks(scenario, [symbol])]
        if not symbol_ticks:
            raise KeyError(symbol)

        return max(symbol_ticks, key=lambda tick: tick.timestamp)

    def latest_quotes(
        self,
        scenario: str = "baseline",
        symbols: list[str] | None = None,
    ) -> list[PriceTick]:
        latest_by_symbol: dict[str, PriceTick] = {}
        for tick in self._filter_ticks(scenario, symbols):
            current = latest_by_symbol.get(tick.symbol)
            if current is None or tick.timestamp > current.timestamp:
                latest_by_symbol[tick.symbol] = tick

        return [latest_by_symbol[symbol] for symbol in sorted(latest_by_symbol)]

    def replay_ticks(
        self,
        scenario: str = "baseline",
        symbols: list[str] | None = None,
    ) -> list[PriceTick]:
        return sorted(
            self._filter_ticks(scenario, symbols),
            key=lambda tick: (tick.timestamp, tick.symbol),
        )

    def scenarios(self) -> list[str]:
        return sorted({tick.scenario for tick in self._ticks})

    def _load_ticks(self) -> list[PriceTick]:
        payload = json.loads(self._fixture_path.read_text(encoding="utf-8"))
        return [PriceTick.model_validate(item) for item in payload]

    def _filter_ticks(
        self,
        scenario: str,
        symbols: list[str] | None,
    ) -> list[PriceTick]:
        symbol_set = {symbol for symbol in symbols or [] if symbol}
        return [
            tick
            for tick in self._ticks
            if tick.scenario == scenario and (not symbol_set or tick.symbol in symbol_set)
        ]
