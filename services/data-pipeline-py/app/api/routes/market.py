import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.schemas.market import PublishQuotesRequest, ReplayQuotesRequest
from app.services.market_data import MockMarketDataService
from app.services.publisher import MarketDataPublisher

router = APIRouter(prefix="/api/data/market/quotes", tags=["market-data"])


@router.get("/latest")
async def latest_quote(
    symbol: str,
    request: Request,
    scenario: str = "baseline",
) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service

    try:
        quote = service.latest_quote(symbol, scenario=scenario)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"symbol not found: {symbol}") from exc

    return {"quote": quote.model_dump(mode="json")}


@router.get("/replay/scenarios")
async def list_scenarios(request: Request) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    return {"scenarios": service.scenarios()}


@router.post("/publish")
async def publish_quotes(
    request: Request,
    body: PublishQuotesRequest | None = None,
) -> dict[str, object]:
    service: MockMarketDataService = request.app.state.market_data_service
    publisher: MarketDataPublisher = request.app.state.market_data_publisher

    payload = body or PublishQuotesRequest()
    latest_ticks = service.latest_quotes(
        scenario=payload.scenario,
        symbols=payload.symbols,
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

    ticks = service.replay_ticks(
        scenario=body.scenario,
        symbols=body.symbols,
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

    return {
        "scenario": body.scenario,
        "published_count": published_count,
        "symbols": sorted({tick.symbol for tick in ticks}),
        "speed_multiplier": body.speed_multiplier,
        "transport": body.transport,
    }
