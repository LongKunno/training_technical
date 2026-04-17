import asyncio

from fastapi import APIRouter, Request

from app.schemas.strategy import PublishSignalsRequest, ReplaySignalsRequest
from app.services.signal_publisher import SignalPublisher
from app.services.strategy_data import MockStrategySignalService

router = APIRouter(prefix="/api/data/strategy/signals", tags=["strategy-signals"])


@router.get("/scenarios")
async def list_signal_scenarios(request: Request) -> dict[str, object]:
    service: MockStrategySignalService = request.app.state.strategy_signal_service
    return {"scenarios": service.scenarios()}


@router.get("")
async def list_signals(
    request: Request,
    scenario: str = "baseline",
    strategy_id: str | None = None,
    limit: int = 0,
    offset: int = 0,
) -> dict[str, object]:
    service: MockStrategySignalService = request.app.state.strategy_signal_service
    signals = service.list_signals(
        scenario=scenario,
        strategy_id=strategy_id,
        limit=limit,
        offset=offset,
    )
    return {"signals": [signal.model_dump(mode="json") for signal in signals]}


@router.post("/publish")
async def publish_signals(
    request: Request,
    body: PublishSignalsRequest | None = None,
) -> dict[str, object]:
    service: MockStrategySignalService = request.app.state.strategy_signal_service
    publisher: SignalPublisher = request.app.state.signal_publisher

    payload = body or PublishSignalsRequest()
    signals = service.list_signals(
        scenario=payload.scenario,
        strategy_id=payload.strategy_id,
        limit=payload.limit,
        offset=payload.offset,
    )
    result = await publisher.publish_signals(signals)

    return {
        "scenario": payload.scenario,
        "published_count": result.published_count,
        "signal_ids": result.signal_ids,
        "strategy_ids": result.strategy_ids,
        "transports": result.transports,
    }


@router.post("/replay")
async def replay_signals(
    request: Request,
    body: ReplaySignalsRequest,
) -> dict[str, object]:
    service: MockStrategySignalService = request.app.state.strategy_signal_service
    publisher: SignalPublisher = request.app.state.signal_publisher

    signals = service.replay_signals(
        scenario=body.scenario,
        strategy_id=body.strategy_id,
    )
    published_count = 0
    previous_timestamp = None
    published_signal_ids: list[str] = []

    for signal in signals:
        if (
            body.speed_multiplier > 0
            and previous_timestamp is not None
            and signal.timestamp > previous_timestamp
        ):
            delay_seconds = (
                signal.timestamp - previous_timestamp
            ).total_seconds() / body.speed_multiplier
            await asyncio.sleep(delay_seconds)

        await publisher.publish_signals([signal])
        published_count += 1
        published_signal_ids.append(signal.signal_id)
        previous_timestamp = signal.timestamp

    return {
        "scenario": body.scenario,
        "published_count": published_count,
        "signal_ids": published_signal_ids,
        "strategy_id": body.strategy_id,
        "speed_multiplier": body.speed_multiplier,
    }
