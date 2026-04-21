from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PriceTick(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    price: float
    source: str
    timestamp: datetime
    scenario: str = "baseline"


class PublishQuotesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: str = "baseline"
    symbols: list[str] = []
    transport: str = "http"


class ReplayQuotesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: str = "baseline"
    symbols: list[str] = []
    speed_multiplier: float = 0.0
    transport: str = "http"


class MarketMicrostructureProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal_latency_ticks: int = 0
    spread_bps: float = 0.0
    max_fill_notional_per_tick: float = 0.0


class ScenarioCatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str
    name: str
    description: str
    symbols: list[str]
    tick_count: int
    started_at: datetime
    ended_at: datetime
    tags: list[str]
    microstructure_profile: MarketMicrostructureProfile
