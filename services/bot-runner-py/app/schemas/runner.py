from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ReplayTick(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    price: float
    source: str
    timestamp: datetime
    scenario: str = "baseline"


class StartRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    bot_id: str
    bot_version: str
    scenario_id: str
    session_id: str
    config: dict[str, Any] = {}
    started_at: datetime
