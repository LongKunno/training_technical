from fastapi import APIRouter, HTTPException, Request, status

from app.core.structured_logging import set_request_log_context

router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "Data Pipeline (Python)",
        "message": "San sang hoat dong, dang hung du lieu tu san Crypto!",
    }


@router.get("/ready")
async def readiness_check(request: Request) -> dict[str, object]:
    market_data_service = request.app.state.market_data_service
    strategy_signal_service = request.app.state.strategy_signal_service

    market_scenarios = market_data_service.scenarios()
    strategy_scenarios = strategy_signal_service.scenarios()
    set_request_log_context(
        request,
        market_scenario_count=len(market_scenarios),
        strategy_scenario_count=len(strategy_scenarios),
    )
    if not market_scenarios or not strategy_scenarios:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="fixtures are not ready",
        )

    return {
        "status": "ok",
        "service": "Data Pipeline (Python)",
        "checks": {
            "market_fixture": {
                "scenario_count": len(market_scenarios),
                "scenarios": market_scenarios,
                "status": "ok",
            },
            "strategy_fixture": {
                "scenario_count": len(strategy_scenarios),
                "scenarios": strategy_scenarios,
                "status": "ok",
            },
        },
    }
