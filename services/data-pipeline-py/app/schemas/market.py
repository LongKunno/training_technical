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
