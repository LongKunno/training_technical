import json
from pathlib import Path

from app.schemas.market import MarketMicrostructureProfile, PriceTick, ScenarioCatalogEntry

SCENARIO_METADATA: dict[str, dict[str, object]] = {
    "baseline": {
        "name": "Baseline Cross-Asset Session",
        "description": (
            "Short balanced replay covering BTC and ETH for smoke tests "
            "and deterministic benchmark runs."
        ),
        "tags": ["smoke", "cross-asset", "balanced"],
        "microstructure_profile": {
            "signal_latency_ticks": 0,
            "spread_bps": 2.5,
            "max_fill_notional_per_tick": 5000,
        },
    },
    "volatility-spike": {
        "name": "Volatility Spike",
        "description": (
            "Fast one-way downside impulse used to verify risk controls "
            "and degraded fill outcomes."
        ),
        "tags": ["stress", "drawdown", "single-asset"],
        "microstructure_profile": {
            "signal_latency_ticks": 1,
            "spread_bps": 10,
            "max_fill_notional_per_tick": 1200,
        },
    },
    "trend-up": {
        "name": "Trend Up",
        "description": (
            "Clean bullish replay designed for buy-and-hold and "
            "trend-following baselines."
        ),
        "tags": ["trend", "bullish", "benchmark"],
        "microstructure_profile": {
            "signal_latency_ticks": 0,
            "spread_bps": 3,
            "max_fill_notional_per_tick": 4000,
        },
    },
    "flash-crash-recovery": {
        "name": "Flash Crash Recovery",
        "description": (
            "Sharp crash followed by partial recovery to compare defensive "
            "versus momentum bots."
        ),
        "tags": ["crash", "recovery", "stress"],
        "microstructure_profile": {
            "signal_latency_ticks": 2,
            "spread_bps": 18,
            "max_fill_notional_per_tick": 900,
        },
    },
    "range-chop": {
        "name": "Range Chop",
        "description": (
            "Sideways oscillation scenario for mean-reversion and "
            "moving-average crossover evaluation."
        ),
        "tags": ["range", "choppy", "benchmark"],
        "microstructure_profile": {
            "signal_latency_ticks": 1,
            "spread_bps": 5,
            "max_fill_notional_per_tick": 2500,
        },
    },
}


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

    def scenario_catalog(self) -> list[ScenarioCatalogEntry]:
        return [self.scenario_detail(scenario) for scenario in self.scenarios()]

    def scenario_detail(self, scenario: str) -> ScenarioCatalogEntry:
        ticks = self.replay_ticks(scenario=scenario)
        if not ticks:
            raise KeyError(scenario)

        metadata = SCENARIO_METADATA.get(
            scenario,
            {
                "name": scenario.replace("-", " ").title(),
                "description": f"Replay scenario {scenario}.",
                "tags": ["custom"],
                "microstructure_profile": {
                    "signal_latency_ticks": 0,
                    "spread_bps": 0,
                    "max_fill_notional_per_tick": 0,
                },
            },
        )
        return ScenarioCatalogEntry(
            scenario_id=scenario,
            name=str(metadata["name"]),
            description=str(metadata["description"]),
            symbols=sorted({tick.symbol for tick in ticks}),
            tick_count=len(ticks),
            started_at=min(tick.timestamp for tick in ticks),
            ended_at=max(tick.timestamp for tick in ticks),
            tags=[str(tag) for tag in metadata.get("tags", [])],
            microstructure_profile=MarketMicrostructureProfile.model_validate(
                metadata.get("microstructure_profile", {})
            ),
        )

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
