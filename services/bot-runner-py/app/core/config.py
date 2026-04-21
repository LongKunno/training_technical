from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    app_title: str = "Bot Runner (Python)"
    app_description: str = "Executes first-party simulation bots against replay scenarios."
    app_version: str = "0.1.0"
    core_trading_base_url: str = "http://core_trading:8080"
    data_pipeline_base_url: str = "http://data_pipeline:8000"
    request_timeout_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "Settings":
        timeout = cls.request_timeout_seconds
        raw_timeout = os.getenv("BOT_RUNNER_REQUEST_TIMEOUT_SECONDS")
        if raw_timeout:
            try:
                timeout = float(raw_timeout)
            except ValueError:
                timeout = cls.request_timeout_seconds

        return cls(
            app_title=os.getenv("BOT_RUNNER_APP_TITLE", cls.app_title),
            app_description=os.getenv("BOT_RUNNER_APP_DESCRIPTION", cls.app_description),
            app_version=os.getenv("BOT_RUNNER_APP_VERSION", cls.app_version),
            core_trading_base_url=os.getenv(
                "CORE_TRADING_BASE_URL",
                cls.core_trading_base_url,
            ),
            data_pipeline_base_url=os.getenv(
                "DATA_PIPELINE_BASE_URL",
                cls.data_pipeline_base_url,
            ),
            request_timeout_seconds=timeout,
        )
