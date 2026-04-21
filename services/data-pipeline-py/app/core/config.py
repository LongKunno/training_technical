import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_title: str = "Data Pipeline Service"
    app_description: str = "Python Crawler & Background Worker API"
    app_version: str = "1.0.0"
    core_trading_internal_base_url: str = "http://core_trading:8080"
    market_data_fixture_path: str = "/app/app/fixtures/mock_ticks.json"
    strategy_signal_fixture_path: str = "/app/app/fixtures/mock_signals.json"
    kafka_bootstrap_servers: str = ""
    kafka_topic: str = "price-ticks-v1"
    ops_benchmark_enabled: bool = False
    ops_benchmark_token: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            app_title=os.getenv("APP_TITLE", cls.app_title),
            app_description=os.getenv("APP_DESCRIPTION", cls.app_description),
            app_version=os.getenv("APP_VERSION", cls.app_version),
            core_trading_internal_base_url=os.getenv(
                "CORE_TRADING_INTERNAL_BASE_URL",
                cls.core_trading_internal_base_url,
            ),
            market_data_fixture_path=os.getenv(
                "MARKET_DATA_FIXTURE_PATH",
                cls.market_data_fixture_path,
            ),
            strategy_signal_fixture_path=os.getenv(
                "STRATEGY_SIGNAL_FIXTURE_PATH",
                cls.strategy_signal_fixture_path,
            ),
            kafka_bootstrap_servers=os.getenv(
                "MARKET_DATA_KAFKA_BOOTSTRAP_SERVERS",
                cls.kafka_bootstrap_servers,
            ),
            kafka_topic=os.getenv("MARKET_DATA_KAFKA_TOPIC", cls.kafka_topic),
            ops_benchmark_enabled=os.getenv("OPS_BENCHMARK_ENABLED", "").lower() == "true",
            ops_benchmark_token=os.getenv("OPS_BENCHMARK_TOKEN", cls.ops_benchmark_token),
        )
