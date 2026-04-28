import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.core.structured_logging import set_request_log_context
from app.schemas.strategy import PublishSignalsRequest, ReplaySignalsRequest
from app.services.signal_publisher import SignalPublisher
from app.services.strategy_data import MockStrategySignalService

router = APIRouter(prefix="/api/data/strategy/signals", tags=["strategy-signals"])


def _ensure_scenario_exists(service: MockStrategySignalService, scenario: str) -> None:
    if scenario not in service.scenarios():
        raise HTTPException(status_code=404, detail=f"scenario not found: {scenario}")


@router.get("/scenarios")
async def list_signal_scenarios(request: Request) -> dict[str, object]:
    service: MockStrategySignalService = request.app.state.strategy_signal_service
    scenarios = service.scenarios()
    set_request_log_context(request, scenario_count=len(scenarios))
    return {"scenarios": scenarios}


@router.get("")
async def list_signals(
    request: Request,
    scenario: str = "baseline",
    strategy_id: str | None = None,
    limit: int = 0,
    offset: int = 0,
) -> dict[str, object]:
    service: MockStrategySignalService = request.app.state.strategy_signal_service
    _ensure_scenario_exists(service, scenario)
    signals = service.list_signals(
        scenario=scenario,
        strategy_id=strategy_id,
        limit=limit,
        offset=offset,
    )
    set_request_log_context(
        request,
        limit=limit,
        offset=offset,
        scenario=scenario,
        signal_count=len(signals),
        strategy_id=strategy_id,
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
    set_request_log_context(
        request,
        limit=payload.limit,
        offset=payload.offset,
        scenario=payload.scenario,
        strategy_id=payload.strategy_id,
    )
    _ensure_scenario_exists(service, payload.scenario)
    signals = service.list_signals(
        scenario=payload.scenario,
        strategy_id=payload.strategy_id,
        limit=payload.limit,
        offset=payload.offset,
    )
    set_request_log_context(request, signal_count=len(signals))
    try:
        result = await publisher.publish_signals(signals)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    set_request_log_context(request, published_count=result.published_count)

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

    set_request_log_context(
        request,
        scenario=body.scenario,
        speed_multiplier=body.speed_multiplier,
        strategy_id=body.strategy_id,
    )
    _ensure_scenario_exists(service, body.scenario)
    signals = service.replay_signals(
        scenario=body.scenario,
        strategy_id=body.strategy_id,
    )
    set_request_log_context(request, signal_count=len(signals))
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

        try:
            await publisher.publish_signals([signal])
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        published_count += 1
        published_signal_ids.append(signal.signal_id)
        previous_timestamp = signal.timestamp

    set_request_log_context(request, published_count=published_count)
    return {
        "scenario": body.scenario,
        "published_count": published_count,
        "signal_ids": published_signal_ids,
        "strategy_id": body.strategy_id,
        "speed_multiplier": body.speed_multiplier,
    }
