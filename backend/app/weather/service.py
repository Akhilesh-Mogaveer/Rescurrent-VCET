"""Weather scenario service: live retrieval, caching, synthetic/replay sets, summaries."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User, WeatherScenario, WeatherScenarioSet, utcnow
from app.optimization.context import IST
from app.services.audit import audit, notify
from app.weather.openmeteo import WeatherFetchError, fetch_ensemble
from app.weather.synthetic import apply_early_rain, generate_synthetic_ensemble

HORIZON_HOURS = 72
_last_error: dict[str, Any] = {"message": None, "at": None}


def floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _store_set(db: Session, *, source_type: str, provider: str, model: str, horizon_start: datetime,
               members: dict[int, list[float]], lat: float, lon: float, label: str, run_time=None,
               grid_lat=None, grid_lon=None, seed=None, parent_id=None, modification=None,
               quality=None, missing=None) -> WeatherScenarioSet:
    hours = len(next(iter(members.values())))
    times = [(horizon_start + timedelta(hours=h)).isoformat() for h in range(hours)]
    ss = WeatherScenarioSet(source_type=source_type, provider=provider, model=model, run_time=run_time,
                            fetched_at=utcnow(), horizon_start=horizon_start, hours=hours, request_lat=lat,
                            request_lon=lon, grid_lat=grid_lat, grid_lon=grid_lon, member_count=len(members),
                            seed=seed, parent_set_id=parent_id, modification=modification,
                            quality=quality or {}, label=label)
    db.add(ss)
    db.flush()
    for mid, vals in members.items():
        db.add(WeatherScenario(set_id=ss.id, member_id=mid, rainfall_mm=vals, valid_times=times,
                               missing_hours=(missing or {}).get(mid, 0)))
    db.flush()
    return ss


def refresh_live(db: Session, user: User | None = None, lat: float | None = None, lon: float | None = None,
                 model: str | None = None) -> WeatherScenarioSet:
    """Fetch the Open-Meteo ensemble and cache it. Raises WeatherFetchError on failure."""
    s = get_settings()
    lat = lat if lat is not None else s.cluster_lat
    lon = lon if lon is not None else s.cluster_lon
    try:
        parsed = fetch_ensemble(lat, lon, model)
    except WeatherFetchError as exc:
        _last_error.update(message=str(exc), at=utcnow().isoformat())
        audit(db, "weather.fetch_failed", "weather", None, f"Live forecast retrieval failed: {exc}", user)
        notify(db, "weather_stale", "Live forecast unavailable",
               f"Open-Meteo request failed ({exc}). Cached or demo scenarios remain in use and are labelled.",
               "warning", "coordinator", "/rain-gap")
        db.commit()
        raise
    now_h = floor_hour(utcnow())
    idx0 = next((i for i, t in enumerate(parsed.times_utc) if t >= now_h), None)
    if idx0 is None or len(parsed.times_utc) - idx0 < 24:
        raise WeatherFetchError("Forecast does not cover the planning horizon")
    n = min(HORIZON_HOURS, len(parsed.times_utc) - idx0)
    members = {mid: v[idx0:idx0 + n] for mid, v in parsed.members.items()}
    ss = _store_set(db, source_type="live", provider=parsed.provider, model=parsed.model,
                    horizon_start=parsed.times_utc[idx0], members=members, lat=lat, lon=lon,
                    grid_lat=parsed.grid_lat, grid_lon=parsed.grid_lon, run_time=parsed.times_utc[0],
                    quality=parsed.quality, missing=parsed.missing,
                    label=f"LIVE forecast · Open-Meteo {parsed.model} · {len(members)} members")
    _last_error.update(message=None, at=None)
    audit(db, "weather.fetched", "weather_scenario_set", ss.id,
          f"Fetched live ensemble ({len(members)} members, {n} h) from Open-Meteo {parsed.model}", user,
          {"grid": [parsed.grid_lat, parsed.grid_lon], "quality": parsed.quality})
    db.commit()
    return ss


def create_synthetic_set(db: Session, seed: int = 42, members: int = 30, hours: int = HORIZON_HOURS,
                         horizon_start: datetime | None = None, source_type: str = "synthetic",
                         label: str | None = None, wetness: float = 1.0) -> WeatherScenarioSet:
    s = get_settings()
    hs = horizon_start or datetime(2026, 7, 15, 0, 30, tzinfo=timezone.utc)
    start_local_hour = hs.astimezone(IST).hour
    data = generate_synthetic_ensemble(hours, members, seed, start_local_hour, wetness)
    ss = _store_set(db, source_type=source_type, provider="MahaliShield synthetic generator",
                    model="markov-gamma-monsoon-v1", horizon_start=hs, members={i: v for i, v in enumerate(data)},
                    lat=s.cluster_lat, lon=s.cluster_lon, seed=seed,
                    quality={"member_count": members, "missing_values": 0, "note": "SYNTHETIC — not a forecast"},
                    label=label or f"SYNTHETIC demo scenarios · seed {seed} · {members} members")
    db.commit()
    return ss


def derive_early_rain(db: Session, parent: WeatherScenarioSet, start_hour: int, end_hour: int,
                      intensity_mm: float, probability: float, seed: int = 7) -> WeatherScenarioSet:
    rain = [sc.rainfall_mm for sc in parent.scenarios]
    mod = apply_early_rain(rain, start_hour, end_hour, intensity_mm, probability, seed)
    ss = _store_set(db, source_type="derived", provider=parent.provider, model=parent.model,
                    horizon_start=parent.horizon_start, members={sc.member_id: m for sc, m in zip(parent.scenarios, mod)},
                    lat=parent.request_lat, lon=parent.request_lon, grid_lat=parent.grid_lat, grid_lon=parent.grid_lon,
                    run_time=parent.run_time, seed=seed, parent_id=parent.id,
                    modification={"type": "early_rain", "start_hour": start_hour, "end_hour": end_hour,
                                  "intensity_mm_per_h": intensity_mm, "member_probability": probability},
                    quality={**(parent.quality or {}), "derived_from": parent.id},
                    label=f"DERIVED from set #{parent.id} ({parent.source_type.upper()}) · early rain h{start_hour}-{end_hour}")
    db.flush()
    return ss


def latest_set(db: Session, source_type: str | None = None) -> WeatherScenarioSet | None:
    q = select(WeatherScenarioSet).order_by(WeatherScenarioSet.fetched_at.desc(), WeatherScenarioSet.id.desc())
    if source_type:
        q = q.where(WeatherScenarioSet.source_type == source_type)
    return db.execute(q.limit(1)).scalar_one_or_none()


def is_stale(ss: WeatherScenarioSet) -> bool:
    if ss.source_type != "live":
        return False
    age_h = (utcnow() - as_utc(ss.fetched_at)).total_seconds() / 3600
    return age_h > get_settings().weather_stale_after_hours


def default_set(db: Session) -> WeatherScenarioSet | None:
    """Prefer the latest live set (flagged stale if old); otherwise the latest synthetic/replay set."""
    live = latest_set(db, "live")
    if live:
        return live
    return latest_set(db, "replay") or latest_set(db, "synthetic") or latest_set(db)


def rain_matrix(ss: WeatherScenarioSet) -> np.ndarray:
    return np.array([sc.rainfall_mm for sc in ss.scenarios], dtype=float)


def set_meta(ss: WeatherScenarioSet) -> dict[str, Any]:
    age_h = (utcnow() - as_utc(ss.fetched_at)).total_seconds() / 3600
    return {
        "id": ss.id, "label": ss.label, "source_type": ss.source_type, "provider": ss.provider, "model": ss.model,
        "run_time": ss.run_time.isoformat() if ss.run_time else None,
        "fetched_at": as_utc(ss.fetched_at).isoformat(), "horizon_start": as_utc(ss.horizon_start).isoformat(),
        "hours": ss.hours, "member_count": ss.member_count, "request_location": [ss.request_lat, ss.request_lon],
        "grid_location": [ss.grid_lat, ss.grid_lon] if ss.grid_lat is not None else None,
        "seed": ss.seed, "parent_set_id": ss.parent_set_id, "modification": ss.modification,
        "quality": ss.quality, "age_hours": round(age_h, 2), "is_stale": is_stale(ss),
        "is_synthetic": ss.source_type in ("synthetic", "replay") or (
            ss.source_type == "derived" and "synthetic" in (ss.provider or "").lower()),
        "evidence_label": "VERIFIED SOURCE FACT" if ss.source_type == "live" else "SIMULATED RESULT",
    }


def summarize(ss: WeatherScenarioSet, op_hours: int = 2, dry_hours: int = 3, max_rain: float = 0.3,
              min_prob: float = 0.6) -> dict[str, Any]:
    R = rain_matrix(ss)
    S, T = R.shape
    hs = as_utc(ss.horizon_start)
    times = [(hs + timedelta(hours=h)).isoformat() for h in range(T)]
    pct = {f"p{p}": np.percentile(R, p, axis=0).round(3).tolist() for p in (10, 25, 50, 75, 90)}
    dry = (R <= max_rain)
    need = op_hours + dry_hours
    window_prob = []
    rain_return = []
    for h in range(T):
        if h + need > T:
            window_prob.append(0.0)
            rain_return.append(None)
            continue
        ok_op = dry[:, h:h + op_hours].all(axis=1)
        ok = dry[:, h:h + need].all(axis=1)
        window_prob.append(round(float(ok.mean()), 3))
        # probability rain returns before the task (incl. drying) completes, given it can start
        rain_return.append(round(float(1 - ok.mean()), 3))
        _ = ok_op
    windows = []
    h = 0
    while h < T:
        lh = (hs + timedelta(hours=h)).astimezone(IST).hour
        if window_prob[h] >= min_prob and 7 <= lh <= 18 - op_hours:
            a = h
            while h < T and window_prob[h] >= min_prob and 7 <= (hs + timedelta(hours=h)).astimezone(IST).hour <= 18 - op_hours:
                h += 1
            seg = window_prob[a:h]
            windows.append({"start_hour": a, "end_hour": h + need - 1, "start_time": times[a],
                            "latest_start_time": times[h - 1], "max_probability": max(seg),
                            "mean_probability": round(float(np.mean(seg)), 3),
                            "rain_return_risk_at_best": round(1 - max(seg), 3)})
        else:
            h += 1
    return {
        "meta": set_meta(ss),
        "times": times,
        "members": [{"member_id": sc.member_id, "rainfall": sc.rainfall_mm} for sc in ss.scenarios],
        "percentiles": pct,
        "mean": R.mean(axis=0).round(3).tolist(),
        "prob_rain": (R > max_rain).mean(axis=0).round(3).tolist(),
        "window_probability": window_prob,
        "rain_return_probability": rain_return,
        "windows": windows,
        "window_rule": {"op_hours": op_hours, "dry_hours_after": dry_hours, "max_rain_mm_per_h": max_rain,
                        "min_probability": min_prob, "working_hours_local": "07:00-18:00 IST"},
        "totals": {"mean_total_mm": round(float(R.sum(axis=1).mean()), 1),
                   "p90_total_mm": round(float(np.percentile(R.sum(axis=1), 90)), 1),
                   "p10_total_mm": round(float(np.percentile(R.sum(axis=1), 10)), 1)},
        "next_dry_window": windows[0] if windows else None,
        "op_hours": op_hours,
    }


def last_error() -> dict[str, Any]:
    return dict(_last_error)
