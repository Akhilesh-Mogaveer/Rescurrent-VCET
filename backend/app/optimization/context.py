"""Planning context: a DB-independent snapshot of everything the planners and validator need.

Time is discretised into 15-minute slots from ``horizon_start`` (UTC). Rainfall scenarios are
hourly. All policies (calendar, reactive, optimized) and the validator consume the same
``PlanningContext`` so that comparisons use identical inputs and constraints.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

from app.simulation.twin import (
    PlotInput,
    efficacy_matrix,
    exposure_sum_by_completion,
    wetness_and_hazard,
)

SLOT_MIN = 15
SPH = 60 // SLOT_MIN  # slots per hour
IST = timezone(timedelta(hours=5, minutes=30))
COST_SCALE = 10000
ROAD_FACTOR = 1.35
TRAVEL_SPEED_KMH = 20.0
TRAVEL_SETUP_MIN = 5.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def travel_slots(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    if abs(lat1 - lat2) < 1e-9 and abs(lon1 - lon2) < 1e-9:
        return 0
    minutes = haversine_km(lat1, lon1, lat2, lon2) * ROAD_FACTOR / TRAVEL_SPEED_KMH * 60 + TRAVEL_SETUP_MIN
    return int(math.ceil(minutes / SLOT_MIN))


@dataclass
class CrewCtx:
    id: int
    code: str
    name: str
    shift_start: int
    shift_end: int
    max_hours_per_day: float
    eligibility: set[str]
    base_lat: float
    base_lon: float
    available: bool = True
    unavailable: list[tuple[int, int, str]] = field(default_factory=list)  # slot ranges [a,b)


@dataclass
class TaskCtx:
    key: str
    code: str
    plot_id: int
    plot_code: str
    duration: int  # slots
    equipment_type: str | None
    predecessor: str | None
    affects_protection: bool
    requires_dry_window: bool
    max_rain: float
    dry_hours: int
    min_prob: float
    lat: float
    lon: float
    weight: float
    area: float
    priority: str


@dataclass
class FixedAssignment:
    task_key: str
    crew_id: int
    start: int
    end: int
    status: str  # completed|in_progress


@dataclass
class PlanningContext:
    horizon_start: datetime
    hours: int
    now_slot: int
    crews: list[CrewCtx]
    tasks: list[TaskCtx]
    equipment_capacity: dict[str, np.ndarray]  # type -> capacity per slot
    travel: dict[tuple[str, str], int]
    window_prob: dict[str, np.ndarray]  # task -> probability (planning scenarios) per start slot
    cost: dict[str, np.ndarray]  # task -> scaled int expected weighted exposure per start slot
    unscheduled_cost: dict[str, int]
    frozen: dict[str, FixedAssignment]
    plots: dict[int, PlotInput]
    rain_plan: np.ndarray
    rain_eval: np.ndarray
    params: dict[str, float]
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def slots(self) -> int:
        return self.hours * SPH

    @property
    def task_map(self) -> dict[str, TaskCtx]:
        return {t.key: t for t in self.tasks}

    @property
    def crew_map(self) -> dict[int, CrewCtx]:
        return {c.id: c for c in self.crews}

    def slot_time(self, slot: int) -> datetime:
        return self.horizon_start + timedelta(minutes=SLOT_MIN * slot)

    def _calendar(self) -> tuple[list[float], list[int]]:
        cal = self.meta.get("_calendar")
        if cal is None or len(cal[0]) != self.slots + 1:
            d0 = self.horizon_start.astimezone(IST).date()
            lh, ld = [], []
            for s in range(self.slots + 1):
                t = self.slot_time(s).astimezone(IST)
                lh.append(t.hour + t.minute / 60.0)
                ld.append((t.date() - d0).days)
            cal = (lh, ld)
            self.meta["_calendar"] = cal
        return cal

    def local_hour(self, slot: int) -> float:
        return self._calendar()[0][slot]

    def local_day(self, slot: int) -> int:
        return self._calendar()[1][slot]

    def tt(self, a: str, b: str) -> int:
        return self.travel.get((a, b), 0)


# ---------------------------------------------------------------------------
# Construction helpers
# ---------------------------------------------------------------------------

def window_probability(rain: np.ndarray, start_slot: int, dur: int, max_rain: float, dry_hours: int,
                       requires_dry: bool) -> float:
    S, T = rain.shape
    h0 = start_slot // SPH
    h1 = int(math.ceil((start_slot + dur) / SPH))
    if h1 > T:
        return 0.0
    ok = np.all(rain[:, h0:h1] <= max_rain, axis=1)
    if requires_dry and dry_hours > 0:
        h2 = min(T, h1 + dry_hours)
        ok &= np.all(rain[:, h1:h2] <= max_rain, axis=1)
    return float(ok.mean())


def build_context(*, horizon_start: datetime, rain_all: np.ndarray, plots: list[PlotInput],
                  plot_locs: dict[int, tuple[float, float]], crews: list[CrewCtx], tasks: list[TaskCtx],
                  equipment: dict[str, list[tuple[int, int | None]]], params: dict[str, float],
                  now_slot: int = 0, frozen: dict[str, FixedAssignment] | None = None,
                  evaluation_mode: str = "in_sample", min_prob_boost: float = 0.0,
                  meta: dict[str, Any] | None = None) -> PlanningContext:
    """Build a planning context.

    equipment: type -> list of (capacity, failed_from_slot or None)
    evaluation_mode: 'in_sample' (plan & evaluate on all members) or 'holdout'
        (plan on even-indexed members, evaluate on odd-indexed members).
    """
    S, T = rain_all.shape
    if evaluation_mode == "holdout" and S >= 4:
        rain_plan, rain_eval = rain_all[0::2], rain_all[1::2]
    else:
        rain_plan, rain_eval = rain_all, rain_all
    slots = T * SPH
    cap: dict[str, np.ndarray] = {}
    for etype, units in equipment.items():
        arr = np.zeros(slots, dtype=int)
        for c, failed_from in units:
            if failed_from is None:
                arr += c
            else:
                arr[: max(0, failed_from)] += c
        cap[etype] = arr

    travel: dict[tuple[str, str], int] = {}
    for a in tasks:
        for b in tasks:
            if a.key != b.key:
                travel[(a.key, b.key)] = travel_slots(a.lat, a.lon, b.lat, b.lon)
        for c in crews:
            travel[(f"base:{c.id}", a.key)] = travel_slots(c.base_lat, c.base_lon, a.lat, a.lon)

    plot_map = {p.plot_id: p for p in plots}
    window_prob: dict[str, np.ndarray] = {}
    cost: dict[str, np.ndarray] = {}
    unscheduled: dict[str, int] = {}
    exp_cache: dict[tuple[int, int], np.ndarray] = {}
    for t in tasks:
        mp = min(0.99, t.min_prob + min_prob_boost)
        t.min_prob = mp
        wp = np.zeros(slots)
        for s in range(slots - t.duration + 1):
            wp[s] = window_probability(rain_plan, s, t.duration, t.max_rain, t.dry_hours, t.requires_dry_window)
        window_prob[t.key] = wp
        if t.affects_protection:
            plot = plot_map[t.plot_id]
            op_hours = int(math.ceil(t.duration / SPH))
            ck = (t.plot_id, op_hours)
            if ck not in exp_cache:
                _, _, H = wetness_and_hazard(plot, rain_plan, params)
                eff = efficacy_matrix(rain_plan, op_hours, t.max_rain, t.dry_hours, params)
                exp_cache[ck] = exposure_sum_by_completion(plot, rain_plan, H, eff, params).mean(axis=0)
            mean_exp = exp_cache[ck]  # (T+1,)
            c = np.zeros(slots, dtype=np.int64)
            for s in range(slots):
                a = min(T, int(math.ceil((s + t.duration) / SPH)))
                c[s] = int(round(mean_exp[a] * plot.weight * COST_SCALE / 100))
            cost[t.key] = c
            unscheduled[t.key] = int(round(mean_exp[T] * plot.weight * COST_SCALE / 100))
        else:
            cost[t.key] = np.zeros(slots, dtype=np.int64)
            unscheduled[t.key] = 0

    return PlanningContext(
        horizon_start=horizon_start, hours=T, now_slot=now_slot, crews=crews, tasks=tasks,
        equipment_capacity=cap, travel=travel, window_prob=window_prob, cost=cost,
        unscheduled_cost=unscheduled, frozen=frozen or {}, plots=plot_map,
        rain_plan=rain_plan, rain_eval=rain_eval, params=params,
        meta={**(meta or {}), "evaluation_mode": evaluation_mode, "plan_members": int(rain_plan.shape[0]),
              "eval_members": int(rain_eval.shape[0]), "min_prob_boost": min_prob_boost},
    )


def crew_slot_ok(ctx: PlanningContext, crew: CrewCtx, slot: int) -> bool:
    lh = ctx.local_hour(slot)
    if not (crew.shift_start <= lh < crew.shift_end):
        return False
    for a, b, _ in crew.unavailable:
        if a <= slot < b:
            return False
    return True


def allowed_starts(ctx: PlanningContext, task: TaskCtx, crew: CrewCtx, enforce_window: bool = True,
                   min_start: int | None = None) -> list[int]:
    """Start slots at which ``crew`` may legally perform ``task`` (hard constraints only)."""
    if not crew.available or task.code not in crew.eligibility:
        return []
    lo = max(ctx.now_slot, min_start or 0)
    base_tt = ctx.tt(f"base:{crew.id}", task.key)
    ok_slot = [crew_slot_ok(ctx, crew, s) for s in range(ctx.slots)]
    cap = ctx.equipment_capacity.get(task.equipment_type) if task.equipment_type else None
    out: list[int] = []
    for s in range(lo, ctx.slots - task.duration + 1):
        if not all(ok_slot[s:s + task.duration]):
            continue
        # must be able to travel from base after shift start on that day
        if ctx.local_hour(s) < crew.shift_start + base_tt / SPH:
            continue
        if ctx.local_day(s) != ctx.local_day(s + task.duration - 1):
            continue
        if cap is not None and (cap[s:s + task.duration] <= 0).any():
            continue
        if enforce_window and ctx.window_prob[task.key][s] + 1e-9 < task.min_prob:
            continue
        out.append(s)
    return out
