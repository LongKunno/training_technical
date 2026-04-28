from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request, Response

logger = logging.getLogger("data_pipeline.request")
logger.setLevel(logging.INFO)


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _clean_context(fields: dict[str, object]) -> dict[str, object]:
    return {
        key: value
        for key, value in fields.items()
        if value is not None and value != "" and value != []
    }


def _query_context(request: Request) -> dict[str, object]:
    context: dict[str, object] = {}
    for key in ("scenario", "strategy_id", "transport", "symbol"):
        values = [value for value in request.query_params.getlist(key) if value]
        if len(values) == 1:
            context[key] = values[0]
        elif values:
            context[key] = values
    return context


def set_request_log_context(request: Request, **fields: object) -> None:
    current = getattr(request.state, "log_context", {})
    request.state.log_context = {
        **current,
        **_clean_context(fields),
    }


def _request_context(request: Request) -> dict[str, object]:
    return {
        **_query_context(request),
        **getattr(request.state, "log_context", {}),
    }


def _write_log(level: str, event: str, **fields: object) -> None:
    payload = {
        "event": event,
        "level": level,
        "service": "data_pipeline",
        "timestamp": _utc_now(),
        **fields,
    }
    message = json.dumps(payload, sort_keys=True)
    if level == "error":
        logger.error(message)
        return
    logger.info(message)


def add_structured_request_logging(app: FastAPI) -> None:
    @app.middleware("http")
    async def structured_request_logging(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        incoming_request_id = request.headers.get("x-request-id", "").strip()
        request_id = incoming_request_id or str(uuid4())
        request.state.request_id = request_id
        started_at = perf_counter()

        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = (perf_counter() - started_at) * 1000
            fields = {
                **_request_context(request),
                "duration_ms": round(duration_ms, 2),
                "error_message": str(exc),
                "error_type": type(exc).__name__,
                "method": request.method,
                "path": request.url.path,
                "request_id": request_id,
                "status": 500,
            }
            _write_log(
                "error",
                "http_request",
                **fields,
            )
            raise

        response.headers["x-request-id"] = request_id
        duration_ms = (perf_counter() - started_at) * 1000
        fields = {
            **_request_context(request),
            "duration_ms": round(duration_ms, 2),
            "method": request.method,
            "path": request.url.path,
            "request_id": request_id,
            "status": response.status_code,
        }
        _write_log(
            "info",
            "http_request",
            **fields,
        )
        return response
