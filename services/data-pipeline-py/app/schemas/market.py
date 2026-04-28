from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
    speed_multiplier: float = Field(default=0.0, ge=0.0, le=1000.0)
    transport: str = "http"


class LiquidityCurvePoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_notional: float = Field(ge=0.0)
    fill_ratio: float = Field(ge=0.0, le=1.0)


class MarketMicrostructureProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal_latency_ticks: int = Field(default=0, ge=0)
    spread_bps: float = Field(default=0.0, ge=0.0)
    max_fill_notional_per_tick: float = Field(default=0.0, ge=0.0)
    liquidity_curve: list[LiquidityCurvePoint] = Field(default_factory=list)
    queue_priority: float = Field(default=0.0, ge=0.0, le=1.0)
    market_impact_bps_per_10k: float = Field(default=0.0, ge=0.0)
    cancel_after_ticks: int = Field(default=0, ge=0)


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
