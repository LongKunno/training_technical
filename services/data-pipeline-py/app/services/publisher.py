import json
from dataclasses import dataclass

import httpx
from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaError

from app.schemas.market import PriceTick


@dataclass(frozen=True)
class PublishResult:
    published_count: int
    symbols: list[str]
    transports: list[str]


class MarketDataPublisher:
    def __init__(
        self,
        core_trading_internal_base_url: str,
        kafka_bootstrap_servers: str,
        kafka_topic: str,
    ) -> None:
        self._core_trading_internal_base_url = core_trading_internal_base_url.rstrip("/")
        self._kafka_bootstrap_servers = kafka_bootstrap_servers.strip()
        self._kafka_topic = kafka_topic

    async def publish_ticks(self, ticks: list[PriceTick]) -> PublishResult:
        payload = {
            "ticks": [tick.model_dump(mode="json", exclude={"scenario"}) for tick in ticks],
        }
        transports: list[str] = []

        await self._publish_to_core(payload)
        transports.append("http")

        if self._kafka_bootstrap_servers:
            await self._publish_to_kafka(payload["ticks"])
            transports.append("kafka")

        return PublishResult(
            published_count=len(ticks),
            symbols=[tick.symbol for tick in ticks],
            transports=transports,
        )

    async def publish_ticks_with_transport(
        self,
        ticks: list[PriceTick],
        transport: str,
    ) -> PublishResult:
        payload = {
            "ticks": [tick.model_dump(mode="json", exclude={"scenario"}) for tick in ticks],
        }
        transports: list[str] = []

        if transport not in {"http", "kafka", "both"}:
            raise ValueError("invalid transport")

        if transport in {"http", "both"}:
            await self._publish_to_core(payload)
            transports.append("http")

        if transport in {"kafka", "both"}:
            if not self._kafka_bootstrap_servers:
                raise RuntimeError("kafka transport is not configured")
            await self._publish_to_kafka(payload["ticks"])
            transports.append("kafka")

        return PublishResult(
            published_count=len(ticks),
            symbols=[tick.symbol for tick in ticks],
            transports=transports,
        )

    async def _publish_to_core(self, payload: dict[str, object]) -> None:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{self._core_trading_internal_base_url}/internal/market/prices",
                    json=payload,
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"core trading market publish failed: {exc}") from exc

    async def _publish_to_kafka(self, ticks: list[dict[str, object]]) -> None:
        try:
            producer = AIOKafkaProducer(bootstrap_servers=self._kafka_bootstrap_servers)
            await producer.start()
            try:
                for tick in ticks:
                    await producer.send_and_wait(
                        self._kafka_topic,
                        json.dumps(tick).encode("utf-8"),
                    )
            finally:
                await producer.stop()
        except KafkaError as exc:
            raise RuntimeError(f"kafka market publish failed: {exc}") from exc
