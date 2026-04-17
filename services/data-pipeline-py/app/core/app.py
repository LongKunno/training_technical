from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import Settings
from app.services.market_data import MockMarketDataService
from app.services.publisher import MarketDataPublisher
from app.services.signal_publisher import SignalPublisher
from app.services.strategy_data import MockStrategySignalService


def create_app(
    settings: Settings | None = None,
    market_data_service: MockMarketDataService | None = None,
    market_data_publisher: MarketDataPublisher | None = None,
    strategy_signal_service: MockStrategySignalService | None = None,
    signal_publisher: SignalPublisher | None = None,
) -> FastAPI:
    app_settings = settings or Settings.from_env()

    app = FastAPI(
        title=app_settings.app_title,
        description=app_settings.app_description,
        version=app_settings.app_version,
    )
    app.state.market_data_service = market_data_service or MockMarketDataService(
        app_settings.market_data_fixture_path,
    )
    app.state.market_data_publisher = market_data_publisher or MarketDataPublisher(
        core_trading_internal_base_url=app_settings.core_trading_internal_base_url,
        kafka_bootstrap_servers=app_settings.kafka_bootstrap_servers,
        kafka_topic=app_settings.kafka_topic,
    )
    app.state.strategy_signal_service = strategy_signal_service or MockStrategySignalService(
        app_settings.strategy_signal_fixture_path,
    )
    app.state.signal_publisher = signal_publisher or SignalPublisher(
        core_trading_internal_base_url=app_settings.core_trading_internal_base_url,
    )
    app.include_router(api_router)

    return app
