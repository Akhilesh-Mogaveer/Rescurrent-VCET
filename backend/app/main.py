"""MahaliShield FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as v1_router
from app.core.config import get_settings
from app.core.database import Base, SessionLocal
from app.core import database as db_module
from app.services.seed import seed_all


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    Base.metadata.create_all(bind=db_module.engine)
    if settings.seed_demo_data:
        with SessionLocal() as db:
            seed_all(db)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="MahaliShield Decision-Intelligence API",
        description=(
            "Uncertainty-Aware Farm Protection Planning for Arecanut Fruit-Rot Risk. "
            "Combines Open-Meteo ensemble forecasts, a transparent agricultural risk & protection twin, "
            "and OR-Tools CP-SAT scheduling with independent constraint validation."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(v1_router)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "MahaliShield API", "version": "1.0.0"}

    return app


app = create_app()
