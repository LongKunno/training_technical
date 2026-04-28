from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StrategySignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str
    signal_id: str
    symbol: str
    side: str
    quantity: float = 0.0
    notional: float = 0.0
    price_hint: float = 0.0
    timestamp: datetime
    scenario: str = "baseline"


class PublishSignalsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: str = "baseline"
    strategy_id: str | None = None
    limit: int = 0
    offset: int = 0


class ReplaySignalsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: str = "baseline"
    strategy_id: str | None = None
    speed_multiplier: float = Field(default=0.0, ge=0.0, le=1000.0)
