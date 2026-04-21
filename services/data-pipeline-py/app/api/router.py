from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.market import router as market_router
from app.api.routes.ops import router as ops_router
from app.api.routes.strategy import router as strategy_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(market_router)
api_router.include_router(ops_router)
api_router.include_router(strategy_router)
