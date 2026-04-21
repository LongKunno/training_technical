from __future__ import annotations

from time import perf_counter, sleep

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/internal/ops", tags=["ops"])

_MAX_CPU_DURATION_MS = 60_000
_MAX_CPU_OUTER_LOOPS = 2_000_000
_MAX_MEMORY_DURATION_MS = 60_000
_MAX_MEMORY_ALLOCATION_MIB = 256


class CpuBenchmarkRequest(BaseModel):
    duration_ms: int = Field(default=15_000, ge=100, le=_MAX_CPU_DURATION_MS)
    outer_loops: int = Field(default=250_000, ge=10_000, le=_MAX_CPU_OUTER_LOOPS)


class MemoryBenchmarkRequest(BaseModel):
    duration_ms: int = Field(default=20_000, ge=100, le=_MAX_MEMORY_DURATION_MS)
    allocation_mib: int = Field(default=96, ge=8, le=_MAX_MEMORY_ALLOCATION_MIB)


def _ensure_benchmark_access(request: Request) -> None:
    settings = request.app.state.settings
    if not settings.ops_benchmark_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")

    expected_token = settings.ops_benchmark_token.strip()
    presented_token = request.headers.get("x-ops-token", "").strip()
    if expected_token == "" or presented_token != expected_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")


@router.post("/benchmark/cpu")
async def benchmark_cpu(body: CpuBenchmarkRequest, request: Request) -> dict[str, int | str]:
    _ensure_benchmark_access(request)

    completed_loops = 0
    target_deadline = perf_counter() + (body.duration_ms / 1000)
    rolling_value = 1

    while perf_counter() < target_deadline:
        for index in range(body.outer_loops):
            rolling_value = (rolling_value * 31 + index) % 1_000_000_007
        completed_loops += body.outer_loops

    return {
        "completed_loops": completed_loops,
        "duration_ms": body.duration_ms,
        "kind": "cpu",
        "last_value": rolling_value,
    }


@router.post("/benchmark/memory")
async def benchmark_memory(body: MemoryBenchmarkRequest, request: Request) -> dict[str, int | str]:
    _ensure_benchmark_access(request)

    allocation = bytearray(body.allocation_mib * 1024 * 1024)
    for index in range(0, len(allocation), 4096):
        allocation[index] = index % 251

    sleep(body.duration_ms / 1000)

    checksum = sum(allocation[::4096]) % 1_000_000_007
    return {
        "allocation_mib": body.allocation_mib,
        "checksum": checksum,
        "duration_ms": body.duration_ms,
        "kind": "memory",
    }
