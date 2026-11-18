"""Open-Meteo Ensemble API client and response parsing.

Docs: https://open-meteo.com/en/docs/ensemble-api
The API returns one array per ensemble member: ``precipitation`` (control) and
``precipitation_memberNN``. Values are the precipitation sum of the preceding hour.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import get_settings

MEMBER_RE = re.compile(r"^precipitation(?:_member(\d+))?$")


class WeatherFetchError(RuntimeError):
    pass


@dataclass
class ParsedEnsemble:
    provider: str
    model: str
    grid_lat: float | None
    grid_lon: float | None
    times_utc: list[datetime]
    members: dict[int, list[float]]  # member_id -> rainfall mm per hour
    missing: dict[int, int]
    units: str
    quality: dict[str, Any] = field(default_factory=dict)


def _to_mm(value: float, units: str) -> float:
    if units in ("inch", "in", "inches"):
        return value * 25.4
    return value


def parse_ensemble_response(payload: dict[str, Any], model: str) -> ParsedEnsemble:
    """Parse an Open-Meteo ensemble JSON payload into aligned member arrays (UTC)."""
    hourly = payload.get("hourly")
    if not isinstance(hourly, dict) or "time" not in hourly:
        raise WeatherFetchError("Response missing 'hourly.time'")
    units_map = payload.get("hourly_units", {}) or {}
    offset = int(payload.get("utc_offset_seconds", 0) or 0)
    times: list[datetime] = []
    for t in hourly["time"]:
        if isinstance(t, (int, float)):
            times.append(datetime.fromtimestamp(t, tz=timezone.utc))
        else:
            dt = datetime.fromisoformat(str(t))
            if dt.tzinfo is None:
                dt = datetime.fromtimestamp(dt.replace(tzinfo=timezone.utc).timestamp() - offset, tz=timezone.utc)
            times.append(dt.astimezone(timezone.utc))
    members: dict[int, list[float]] = {}
    missing: dict[int, int] = {}
    units = "mm"
    for key, values in hourly.items():
        m = MEMBER_RE.match(key)
        if not m or not isinstance(values, list):
            continue
        mid = int(m.group(1)) if m.group(1) else 0
        units = str(units_map.get(key, "mm"))
        clean: list[float] = []
        miss = 0
        for v in values:
            if v is None or (isinstance(v, float) and math.isnan(v)):
                clean.append(0.0)
                miss += 1
            else:
                clean.append(max(0.0, _to_mm(float(v), units)))
        if len(clean) != len(times):
            raise WeatherFetchError(f"Member {key} length {len(clean)} != time length {len(times)}")
        members[mid] = clean
        missing[mid] = miss
    if not members:
        raise WeatherFetchError("No precipitation members found in response")
    total = sum(len(v) for v in members.values())
    quality = {
        "member_count": len(members),
        "missing_values": sum(missing.values()),
        "missing_fraction": round(sum(missing.values()) / max(total, 1), 4),
        "source_units": units,
        "normalized_units": "mm/h",
        "missing_policy": "missing values replaced by 0.0 mm and counted",
    }
    return ParsedEnsemble(
        provider="Open-Meteo Ensemble API",
        model=model,
        grid_lat=payload.get("latitude"),
        grid_lon=payload.get("longitude"),
        times_utc=times,
        members=dict(sorted(members.items())),
        missing=missing,
        units=units,
        quality=quality,
    )


def fetch_ensemble(lat: float, lon: float, model: str | None = None, forecast_days: int = 4) -> ParsedEnsemble:
    settings = get_settings()
    model = model or settings.open_meteo_model
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation",
        "models": model,
        "forecast_days": forecast_days,
        "timezone": "GMT",
        "precipitation_unit": "mm",
    }
    try:
        resp = httpx.get(settings.open_meteo_ensemble_url, params=params, timeout=settings.weather_timeout_s)
    except httpx.HTTPError as exc:
        raise WeatherFetchError(f"Network error contacting Open-Meteo: {exc}") from exc
    if resp.status_code != 200:
        raise WeatherFetchError(f"Open-Meteo returned HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise WeatherFetchError("Open-Meteo returned invalid JSON") from exc
    if payload.get("error"):
        raise WeatherFetchError(f"Open-Meteo error: {payload.get('reason')}")
    return parse_ensemble_response(payload, model)
