"""Application configuration loaded from environment variables (.env supported)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MahaliShield API"
    environment: str = "development"
    database_url: str = "sqlite:///./mahalishield.db"
    secret_key: str = "dev-only-change-me-in-production-please"
    access_token_expire_minutes: int = 60 * 12
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Weather
    open_meteo_ensemble_url: str = "https://ensemble-api.open-meteo.com/v1/ensemble"
    open_meteo_model: str = "icon_seamless"
    weather_timeout_s: float = 12.0
    weather_stale_after_hours: float = 6.0
    timezone: str = "Asia/Kolkata"

    # Cluster centre (Thirthahalli taluk, Shivamogga district, Karnataka) used for forecast retrieval
    cluster_lat: float = 13.6889
    cluster_lon: float = 75.2422

    # Optimizer
    solver_time_limit_s: float = 10.0
    solver_workers: int = 8

    # Optional Gemini
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"

    seed_demo_data: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
