from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict[str, object]:
    runner_service = request.app.state.runner_service

    return {
        "status": "ok",
        "service": "Bot Runner (Python)",
        "message": "Simulation bots are ready to execute against replayed market data.",
        "active_runs": runner_service.active_run_count(),
    }
