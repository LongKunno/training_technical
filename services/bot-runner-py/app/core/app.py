from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import Settings
from app.services.runner_service import RunnerService


def create_app(
    settings: Settings | None = None,
    runner_service: RunnerService | None = None,
) -> FastAPI:
    app_settings = settings or Settings.from_env()

    app = FastAPI(
        title=app_settings.app_title,
        description=app_settings.app_description,
        version=app_settings.app_version,
    )
    app.state.settings = app_settings
    app.state.runner_service = runner_service or RunnerService(
        core_trading_base_url=app_settings.core_trading_base_url,
        data_pipeline_base_url=app_settings.data_pipeline_base_url,
        request_timeout_seconds=app_settings.request_timeout_seconds,
    )
    app.include_router(api_router)

    return app
