from fastapi import APIRouter, HTTPException, Request

from app.schemas.runner import StartRunRequest
from app.services.runner_service import RunnerService

router = APIRouter(prefix="/internal/runs", tags=["runs"])


@router.post("/start", status_code=202)
async def start_run(request: Request, body: StartRunRequest) -> dict[str, object]:
    runner_service: RunnerService = request.app.state.runner_service

    try:
        await runner_service.start_run(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "run_id": body.run_id,
        "status": "accepted",
    }


@router.post("/{run_id}/stop")
async def stop_run(run_id: str, request: Request) -> dict[str, object]:
    runner_service: RunnerService = request.app.state.runner_service

    try:
        await runner_service.stop_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"run not found: {run_id}") from exc

    return {
        "run_id": run_id,
        "status": "stopping",
    }
