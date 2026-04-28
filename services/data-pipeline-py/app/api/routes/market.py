import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.core.structured_logging import set_request_log_context
from app.schemas.market import PublishQuotesRequest, ReplayQuotesRequest
from app.services.market_data import MockMarketDataService
from app.services.publisher import MarketDataPublisher

router = APIRouter(prefix="/api/data/market/quotes", tags=["market-data"])


def _ensure_scenario_exists(service: MockMarketDataService, scenario: str) -> None:
    if scenario not in service.scenarios():
        raise HTTPException(status_code=404, detail=f"scenario not found: {scenario}")


@router.get("/latest")
async def latest_quote(
    symbol: str,
    request: Request,
    scenario: str = "baseline",
) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    _ensure_scenario_exists(service, scenario)
    set_request_log_context(request, scenario=scenario, symbol=symbol)

    try:
        quote = service.latest_quote(symbol, scenario=scenario)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"symbol not found: {symbol}") from exc

    return {"quote": quote.model_dump(mode="json")}


@router.get("/replay/scenarios")
async def list_scenarios(request: Request) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    scenarios = service.scenarios()
    set_request_log_context(request, scenario_count=len(scenarios))
    return {"scenarios": scenarios}


@router.get("/replay/catalog")
async def list_scenario_catalog(request: Request) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    scenarios = service.scenario_catalog()
    set_request_log_context(request, scenario_count=len(scenarios))
    return {
        "scenarios": [scenario.model_dump(mode="json") for scenario in scenarios],
    }


@router.get("/replay/catalog/{scenario_id}")
async def get_scenario_catalog_entry(scenario_id: str, request: Request) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    try:
        scenario = service.scenario_detail(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"scenario not found: {scenario_id}") from exc

    set_request_log_context(request, scenario=scenario_id)
    return {"scenario": scenario.model_dump(mode="json")}


@router.get("/replay")
async def list_replay_ticks(
    request: Request,
    scenario: str = "baseline",
    symbol: list[str] | None = None,
) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    _ensure_scenario_exists(service, scenario)
    ticks = service.replay_ticks(
        scenario=scenario,
        symbols=symbol,
    )
    set_request_log_context(
        request,
        scenario=scenario,
        symbol=symbol,
        tick_count=len(ticks),
    )

    return {
        "scenario": scenario,
        "count": len(ticks),
        "ticks": [tick.model_dump(mode="json") for tick in ticks],
    }


@router.post("/publish")
async def publish_quotes(
    request: Request,
    body: PublishQuotesRequest | None = None,
) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    publisher: MarketDataPublisher = request.app.state.market_data_publisher

    payload = body or PublishQuotesRequest()
    set_request_log_context(
        request,
        scenario=payload.scenario,
        symbol=payload.symbols,
        transport=payload.transport,
    )
    _ensure_scenario_exists(service, payload.scenario)
    latest_ticks = service.latest_quotes(
        scenario=payload.scenario,
        symbols=payload.symbols,
    )
    set_request_log_context(
        request,
        tick_count=len(latest_ticks),
    )
    try:
        result = await publisher.publish_ticks_with_transport(latest_ticks, payload.transport)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "scenario": payload.scenario,
        "published_count": result.published_count,
        "symbols": result.symbols,
        "transport": payload.transport,
        "transports": result.transports,
    }


@router.post("/replay")
async def replay_quotes(
    request: Request,
    body: ReplayQuotesRequest,
) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    publisher: MarketDataPublisher = request.app.state.market_data_publisher

    set_request_log_context(
        request,
        scenario=body.scenario,
        speed_multiplier=body.speed_multiplier,
        symbol=body.symbols,
        transport=body.transport,
    )
    _ensure_scenario_exists(service, body.scenario)
    ticks = service.replay_ticks(
        scenario=body.scenario,
        symbols=body.symbols,
    )
    set_request_log_context(
        request,
        tick_count=len(ticks),
    )
    published_count = 0
    previous_timestamp = None
    for tick in ticks:
        if (
            body.speed_multiplier > 0
            and previous_timestamp is not None
            and tick.timestamp > previous_timestamp
        ):
            delay_seconds = (
                tick.timestamp - previous_timestamp
            ).total_seconds() / body.speed_multiplier
            await asyncio.sleep(delay_seconds)

        try:
            await publisher.publish_ticks_with_transport([tick], body.transport)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        published_count += 1
        previous_timestamp = tick.timestamp

    set_request_log_context(request, published_count=published_count)
    return {
        "scenario": body.scenario,
        "published_count": published_count,
        "symbols": sorted({tick.symbol for tick in ticks}),
        "speed_multiplier": body.speed_multiplier,
        "transport": body.transport,
    }
