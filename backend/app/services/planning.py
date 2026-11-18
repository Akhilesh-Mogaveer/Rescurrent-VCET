"""Planning service: builds PlanningContext from the database, persists plans with
explanations, and implements dynamic replanning with frozen work."""
from __future__ import annotations

import math
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    Assignment,
    Crew,
    DisruptionEvent,
    Equipment,
    Plan,
    Plot,
    TaskRule,
    TwinParameterSet,
    User,
    WeatherScenarioSet,
    utcnow,
)
from app.optimization.context import (
    SLOT_MIN,
    SPH,
    CrewCtx,
    FixedAssignment,
    PlanningContext,
    TaskCtx,
    allowed_starts,
    build_context,
)
from app.optimization.cpsat import diagnose_unscheduled, solve_cpsat
from app.optimization.validator import PlannedTask, validate_plan
from app.policies.arena import calendar_policy, evaluate, reactive_policy
from app.simulation.twin import PRIORITY_WEIGHTS, PlotInput
from app.weather.service import as_utc, rain_matrix

ACTIVE_PLOT_STATUSES = ("pending", "scheduled")


def active_parameter_set(db: Session, sensitivity: str = "base") -> TwinParameterSet:
    ps = db.execute(select(TwinParameterSet).where(TwinParameterSet.is_active.is_(True),
                                                   TwinParameterSet.sensitivity == sensitivity)
                    .order_by(TwinParameterSet.id.desc())).scalars().first()
    if ps is None:
        raise ValueError(f"No active parameter set for sensitivity '{sensitivity}'")
    return ps


def plot_inputs(plots: list[Plot], priority_overrides: dict[str, str] | None = None) -> list[PlotInput]:
    po = priority_overrides or {}
    return [PlotInput(p.id, p.code, p.area_acres, po.get(str(p.id), p.priority), p.drainage, p.canopy_density,
                      p.protection_state) for p in plots]


def _slot_of(horizon_start, dt) -> int:
    return int(math.floor((as_utc(dt) - as_utc(horizon_start)).total_seconds() / 60 / SLOT_MIN))


def build_from_db(db: Session, scenario_set: WeatherScenarioSet, param_set: TwinParameterSet, *,
                  now_slot: int = 0, overrides: dict[str, Any] | None = None,
                  frozen: dict[str, FixedAssignment] | None = None, evaluation_mode: str = "in_sample",
                  plot_ids: list[int] | None = None) -> PlanningContext:
    ov = overrides or {}
    hs = as_utc(scenario_set.horizon_start)
    q = select(Plot).where(Plot.status.in_(ACTIVE_PLOT_STATUSES)).order_by(Plot.code)
    plots = list(db.execute(q).scalars())
    frozen = frozen or {}
    frozen_plot_ids = {int(k.split("#")[1]) for k in frozen if "#" in k}
    if plot_ids:
        plots = [p for p in plots if p.id in plot_ids or p.id in frozen_plot_ids]
    # plots with frozen work must stay in context even if status changed
    have = {p.id for p in plots}
    for pid in frozen_plot_ids - have:
        p = db.get(Plot, pid)
        if p:
            plots.append(p)
    rules = list(db.execute(select(TaskRule).where(TaskRule.is_active.is_(True))).scalars())
    pinputs = plot_inputs(plots, ov.get("priority_overrides"))
    pin_map = {p.plot_id: p for p in pinputs}
    dur_over = ov.get("duration_overrides", {})

    tasks: list[TaskCtx] = []
    for p in plots:
        codes = []
        for r in rules:
            if r.applies_to == "inspection_required" and not p.inspection_required:
                continue
            codes.append(r)
        present = {r.code for r in codes}
        for r in codes:
            key = f"{r.code}#{p.id}"
            minutes = r.setup_minutes + r.minutes_per_acre * p.area_acres
            dur = int(math.ceil(minutes / SLOT_MIN))
            pred = f"{r.predecessor_code}#{p.id}" if r.predecessor_code and r.predecessor_code in present else None
            pi = pin_map[p.id]
            tasks.append(TaskCtx(
                key=key, code=r.code, plot_id=p.id, plot_code=p.code, duration=int(dur_over.get(key, dur)),
                equipment_type=r.required_equipment_type, predecessor=pred, affects_protection=r.affects_protection,
                requires_dry_window=r.requires_dry_window, max_rain=r.max_rain_mm_per_hour,
                dry_hours=r.dry_hours_after if r.requires_dry_window else 0, min_prob=r.min_window_probability,
                lat=p.lat, lon=p.lon, weight=pi.weight, area=p.area_acres, priority=pi.priority))

    crew_unavail = ov.get("crew_unavailable", [])
    crews: list[CrewCtx] = []
    for c in db.execute(select(Crew).order_by(Crew.code)).scalars():
        un: list[tuple[int, int, str]] = []
        for per in c.unavailable_periods or []:
            try:
                from datetime import datetime as _dt
                a = _slot_of(hs, _dt.fromisoformat(per["start"]))
                b = _slot_of(hs, _dt.fromisoformat(per["end"]))
                un.append((max(0, a), max(0, b), per.get("reason", "registered unavailability")))
            except (KeyError, ValueError):
                continue
        for u in crew_unavail:
            if int(u["crew_id"]) == c.id:
                un.append((int(u["start_slot"]), int(u["end_slot"]), u.get("reason", "disruption")))
        crews.append(CrewCtx(c.id, c.code, c.name, c.shift_start_hour, c.shift_end_hour, c.max_hours_per_day,
                             set(c.eligibility or []), c.base_lat, c.base_lon, c.is_available, un))

    failed = {int(f["equipment_id"]): int(f["from_slot"]) for f in ov.get("equipment_failed", [])}
    equipment: dict[str, list[tuple[int, int | None]]] = {}
    for e in db.execute(select(Equipment)).scalars():
        equipment.setdefault(e.type, [])
        if e.status != "operational" or not e.is_available:
            continue
        equipment[e.type].append((e.capacity, failed.get(e.id)))

    rain = rain_matrix(scenario_set)
    boost = 0.15 if ov.get("weather_stale") else 0.0
    ctx = build_context(horizon_start=hs, rain_all=rain, plots=pinputs, plot_locs={p.id: (p.lat, p.lon) for p in plots},
                        crews=crews, tasks=tasks, equipment=equipment, params=param_set.params, now_slot=now_slot,
                        frozen=frozen, evaluation_mode=evaluation_mode, min_prob_boost=boost,
                        meta={"scenario_set_id": scenario_set.id, "parameter_set_id": param_set.id})
    return ctx


# ---------------------------------------------------------------------------
# Explanations
# ---------------------------------------------------------------------------

def explain_assignment(ctx: PlanningContext, a: PlannedTask, all_asg: list[PlannedTask]) -> dict[str, Any]:
    t = ctx.task_map[a.task_key]
    crew = ctx.crew_map[a.crew_id]
    wp = float(ctx.window_prob[t.key][a.start])
    exp_c = ctx.cost[t.key][a.start] / 100
    exp_u = ctx.unscheduled_cost[t.key] / 100
    out: dict[str, Any] = {
        "window_probability": round(wp, 3),
        "approved_min_probability": t.min_prob,
        "expected_weighted_exposure": round(exp_c, 3) if t.affects_protection else None,
        "weighted_exposure_if_unprotected": round(exp_u, 3) if t.affects_protection else None,
        "expected_reduction": round(exp_u - exp_c, 3) if t.affects_protection else None,
        "plot_weight": round(t.weight, 3),
        "duration_minutes": t.duration * SLOT_MIN,
        "local_start": ctx.slot_time(a.start).isoformat(),
        "frozen": a.frozen,
        "factors": [],
    }
    f = out["factors"]
    if a.frozen:
        f.append(f"Task was {a.status} before replanning and is locked (completed work is immutable).")
        return out
    if t.affects_protection:
        best_s = int(ctx.cost[t.key].argmin())
        f.append(f"Plot weight {t.weight:.2f} = {t.area} acres × priority '{t.priority}' weight "
                 f"{PRIORITY_WEIGHTS.get(t.priority, 1.0)}.")
        f.append(f"Expected weighted exposure falls from {exp_u:.2f} (unprotected) to {exp_c:.2f} with this slot "
                 f"(reduction {exp_u - exp_c:.2f}; simulated, relative index).")
        if best_s != a.start:
            f.append(f"The single best slot for this plot in isolation ({ctx.slot_time(best_s).isoformat()}) would give "
                     f"{ctx.cost[t.key][best_s] / 100:.2f}; it was not used because crew time, equipment or travel was "
                     f"allocated to plots with larger combined benefit, or it violates a hard constraint.")
    f.append(f"{wp:.0%} of planning scenarios keep this window dry enough (≤{t.max_rain} mm/h during the task"
             + (f" and {t.dry_hours} h after" if t.requires_dry_window and t.dry_hours else "")
             + f"); approved minimum is {t.min_prob:.0%}.")
    prev = [o for o in all_asg if o.crew_id == a.crew_id and o.end <= a.start]
    if prev:
        p = max(prev, key=lambda o: o.end)
        f.append(f"{crew.code} arrives from {ctx.task_map[p.task_key].plot_code} "
                 f"(travel {ctx.tt(p.task_key, t.key) * SLOT_MIN} min, buffer respected).")
    else:
        f.append(f"{crew.code} starts from base (travel {ctx.tt(f'base:{crew.id}', t.key) * SLOT_MIN} min).")
    others = []
    for c in ctx.crews:
        if c.id == a.crew_id:
            continue
        if t.code not in c.eligibility:
            others.append(f"{c.code}: not eligible for {t.code}")
        elif not c.available:
            others.append(f"{c.code}: unavailable")
        elif a.start not in allowed_starts(ctx, t, c, True):
            others.append(f"{c.code}: shift/availability/travel does not allow this start")
        else:
            busy = [o for o in all_asg if o.crew_id == c.id and not (
                o.end + ctx.tt(o.task_key, t.key) <= a.start or a.end + ctx.tt(t.key, o.task_key) <= o.start)]
            others.append(f"{c.code}: busy with {ctx.task_map[busy[0].task_key].plot_code}" if busy
                          else f"{c.code}: feasible alternative; solver preferred {crew.code} for overall objective")
    out["crew_alternatives"] = others
    return out


def persist_plan(db: Session, ctx: PlanningContext, assignments: list[PlannedTask], solver: dict[str, Any], *,
                 name: str, scenario_set: WeatherScenarioSet, param_set: TwinParameterSet, user: User | None,
                 policy: str = "optimized", parent: Plan | None = None, overrides: dict[str, Any] | None = None,
                 disruption: DisruptionEvent | None = None, simulation_run_id: int | None = None) -> Plan:
    validation = validate_plan(ctx, assignments, enforce_windows=(policy != "calendar"))
    metrics = evaluate(ctx, assignments)
    metrics.pop("weighted_exposure_distribution", None)
    unscheduled = diagnose_unscheduled(ctx, assignments)
    plan = Plan(
        name=name, version=(parent.version + 1) if parent else 1, parent_plan_id=parent.id if parent else None,
        lineage_id=(parent.lineage_id or parent.id) if parent else None, status="draft", policy=policy,
        scenario_set_id=scenario_set.id, parameter_set_id=param_set.id, simulation_run_id=simulation_run_id,
        horizon_start=ctx.horizon_start, horizon_hours=ctx.hours, now_slot=ctx.now_slot,
        context={"overrides": overrides or {}, "evaluation_mode": ctx.meta.get("evaluation_mode"),
                 "plan_members": ctx.meta.get("plan_members"), "min_prob_boost": ctx.meta.get("min_prob_boost"),
                 "task_count": len(ctx.tasks), "crew_count": len(ctx.crews),
                 "equipment_capacity": {k: int(v.max()) for k, v in ctx.equipment_capacity.items()}},
        solver=solver, validation=validation, unscheduled=unscheduled, metrics=metrics,
        disruption_event_id=disruption.id if disruption else None, created_by=user.id if user else None)
    db.add(plan)
    db.flush()
    if plan.lineage_id is None:
        plan.lineage_id = plan.id
    tmap = ctx.task_map
    for a in assignments:
        t = tmap[a.task_key]
        status = a.status if a.frozen else "planned"
        db.add(Assignment(
            plan_id=plan.id, task_key=a.task_key, task_code=t.code, plot_id=t.plot_id, crew_id=a.crew_id,
            equipment_type=t.equipment_type, start_slot=a.start, end_slot=a.end,
            travel_slots=0, start_time=ctx.slot_time(a.start), end_time=ctx.slot_time(a.end), status=status,
            frozen=a.frozen, window_probability=float(ctx.window_prob[t.key][min(a.start, ctx.slots - 1)]),
            expected_exposure=round(ctx.cost[t.key][min(a.start, ctx.slots - 1)] / 100, 3) if t.affects_protection else None,
            exposure_if_unprotected=round(ctx.unscheduled_cost[t.key] / 100, 3) if t.affects_protection else None,
            explanation=explain_assignment(ctx, a, assignments)))
    # travel slots (from previous task on the same crew & day, or from base)
    db.flush()
    by_crew: dict[int, list[Assignment]] = {}
    for asg in plan.assignments:
        by_crew.setdefault(asg.crew_id, []).append(asg)
    for cid, lst in by_crew.items():
        lst.sort(key=lambda x: x.start_slot)
        prev = None
        for asg in lst:
            if prev is not None and ctx.local_day(prev.start_slot) == ctx.local_day(asg.start_slot):
                asg.travel_slots = ctx.tt(prev.task_key, asg.task_key)
            else:
                asg.travel_slots = ctx.tt(f"base:{cid}", asg.task_key)
            prev = asg
    db.flush()
    return plan


def run_policy(ctx: PlanningContext, policy: str, time_limit: float | None = None, seed: int = 0):
    s = get_settings()
    if policy == "calendar":
        return calendar_policy(ctx), {"engine": "list scheduler", "status": "HEURISTIC", "policy": "calendar"}
    if policy == "reactive":
        return reactive_policy(ctx), {"engine": "list scheduler", "status": "HEURISTIC", "policy": "reactive"}
    r = solve_cpsat(ctx, time_limit_s=time_limit or s.solver_time_limit_s, workers=s.solver_workers, seed=seed)
    return r["assignments"], r["solver"]


# ---------------------------------------------------------------------------
# Replanning
# ---------------------------------------------------------------------------

def frozen_from_plan(plan: Plan, now_slot: int, duration_overrides: dict[str, int]) -> dict[str, FixedAssignment]:
    frozen: dict[str, FixedAssignment] = {}
    for a in plan.assignments:
        if a.frozen or a.status == "completed" or a.end_slot <= now_slot:
            frozen[a.task_key] = FixedAssignment(a.task_key, a.crew_id, a.start_slot, a.end_slot, "completed")
        elif a.start_slot < now_slot < a.end_slot or a.status == "in_progress":
            end = a.end_slot
            if a.task_key in duration_overrides:
                end = a.start_slot + int(duration_overrides[a.task_key])
            frozen[a.task_key] = FixedAssignment(a.task_key, a.crew_id, a.start_slot, end, "in_progress")
    return frozen


def diff_plans(prev: Plan, new_asg: list[Assignment], ctx: PlanningContext, disruption: DisruptionEvent,
               new_unscheduled: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pmap = {a.task_key: a for a in prev.assignments}
    nmap = {a.task_key: a for a in new_asg}
    tmap = ctx.task_map
    crews = ctx.crew_map
    unsched_reasons = {u["task_key"]: u["reasons"] for u in new_unscheduled}
    keys = sorted(set(pmap) | set(nmap) | set(unsched_reasons), key=lambda k: (tmap[k].plot_code if k in tmap else k))
    out = []
    payload = disruption.payload or {}
    for k in keys:
        p, n = pmap.get(k), nmap.get(k)
        t = tmap.get(k)
        plot_code = t.plot_code if t else k
        entry: dict[str, Any] = {"task_key": k, "plot_code": plot_code,
                                 "previous": None if p is None else {"crew_id": p.crew_id, "start_slot": p.start_slot,
                                                                     "end_slot": p.end_slot,
                                                                     "start_time": as_utc(p.start_time).isoformat()},
                                 "new": None if n is None else {"crew_id": n.crew_id, "start_slot": n.start_slot,
                                                                "end_slot": n.end_slot,
                                                                "start_time": as_utc(n.start_time).isoformat()}}
        reasons: list[str] = []
        if n is not None and n.frozen:
            change = "frozen"
            reasons.append(f"{n.status.replace('_', '-')} before the disruption at slot {ctx.now_slot}; locked")
            if p and p.end_slot != n.end_slot:
                change = "frozen_extended"
                reasons.append(f"duration extended by {(n.end_slot - p.end_slot) * SLOT_MIN} min (task overrun)")
        elif p and n:
            if p.crew_id == n.crew_id and p.start_slot == n.start_slot:
                change = "unchanged"
            elif p.crew_id != n.crew_id:
                change = "reassigned"
            else:
                change = "rescheduled"
            if change != "unchanged" and t:
                old_wp = float(ctx.window_prob[k][min(p.start_slot, ctx.slots - 1)])
                crew_old = crews.get(p.crew_id)
                if p.start_slot < ctx.now_slot:
                    reasons.append("original start time has already passed")
                if old_wp + 1e-9 < t.min_prob:
                    reasons.append(f"original window now has only {old_wp:.0%} dry-window probability "
                                   f"(below {t.min_prob:.0%}) under updated scenarios")
                if crew_old and (not crew_old.available or any(a <= s < b for a, b, _ in crew_old.unavailable
                                                                for s in range(p.start_slot, p.end_slot))):
                    reasons.append(f"{crew_old.code} unavailable during the original slot")
                if disruption.type == "equipment_failure" and t.equipment_type:
                    reasons.append("equipment capacity reduced by failure")
                if disruption.type == "urgent_priority" and str(payload.get("plot_id")) != str(t.plot_id):
                    reasons.append("crew time re-allocated to the urgent plot")
                if disruption.type == "urgent_priority" and str(payload.get("plot_id")) == str(t.plot_id):
                    reasons.append("plot escalated to urgent priority")
                if not reasons:
                    reasons.append("cascade: re-optimized around changed tasks to minimise expected weighted exposure")
        elif p and not n:
            change = "newly_unscheduled"
            reasons += unsched_reasons.get(k, ["no feasible slot remains"])
        elif n and not p:
            change = "newly_scheduled"
            reasons.append("now fits within an approved window after re-optimization")
        else:
            change = "still_unscheduled"
            reasons += unsched_reasons.get(k, [])
        entry["change"] = change
        entry["reasons"] = reasons
        if p and crews.get(p.crew_id):
            entry["previous"]["crew_code"] = crews[p.crew_id].code
        if n and crews.get(n.crew_id):
            entry["new"]["crew_code"] = crews[n.crew_id].code
        out.append(entry)
    return out


def apply_disruption_overrides(db: Session, plan: Plan, ev: DisruptionEvent) -> tuple[dict[str, Any], WeatherScenarioSet]:
    """Return updated overrides and the scenario set to use, given the disruption event."""
    from app.weather.service import default_set, derive_early_rain, refresh_live

    ov = {k: (list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v)
          for k, v in (plan.context or {}).get("overrides", {}).items()}
    ov.setdefault("crew_unavailable", [])
    ov.setdefault("equipment_failed", [])
    ov.setdefault("priority_overrides", {})
    ov.setdefault("duration_overrides", {})
    ss = db.get(WeatherScenarioSet, plan.scenario_set_id)
    p = ev.payload or {}
    now = ev.occurs_at_slot
    if ev.type == "early_rain":
        start_h = int(p.get("start_hour", now // SPH))
        end_h = int(p.get("end_hour", start_h + 4))
        ss = derive_early_rain(db, ss, start_h, end_h, float(p.get("intensity_mm", 4.0)),
                               float(p.get("probability", 0.85)), int(p.get("seed", 7)))
    elif ev.type == "crew_unavailable":
        ov["crew_unavailable"].append({"crew_id": int(p["crew_id"]), "start_slot": int(p.get("start_slot", now)),
                                       "end_slot": int(p.get("end_slot", plan.horizon_hours * SPH)),
                                       "reason": p.get("reason", "crew unavailable")})
    elif ev.type == "equipment_failure":
        ov["equipment_failed"].append({"equipment_id": int(p["equipment_id"]), "from_slot": int(p.get("from_slot", now))})
    elif ev.type == "urgent_priority":
        ov["priority_overrides"][str(int(p["plot_id"]))] = "urgent"
    elif ev.type == "task_overrun":
        key = p["task_key"]
        a = next((x for x in plan.assignments if x.task_key == key), None)
        if a is None:
            raise ValueError(f"Task {key} not in plan")
        ov["duration_overrides"][key] = (a.end_slot - a.start_slot) + int(math.ceil(int(p.get("extra_minutes", 60)) / SLOT_MIN))
    elif ev.type == "weather_unavailable":
        ov["weather_stale"] = True
        if p.get("attempt_refresh"):
            try:
                ss = refresh_live(db)
                ov["weather_stale"] = False
            except Exception:
                ss = db.get(WeatherScenarioSet, plan.scenario_set_id) or default_set(db)
    elif ev.type == "refresh_weather":
        pass
    return ov, ss


def mark_progress(plan: Plan, now_slot: int) -> None:
    for a in plan.assignments:
        if a.frozen:
            continue
        if a.end_slot <= now_slot:
            a.status = "completed"
        elif a.start_slot < now_slot:
            a.status = "in_progress"


def ensure_time(ctx: PlanningContext) -> str:
    return (ctx.horizon_start + timedelta(minutes=SLOT_MIN * ctx.now_slot)).isoformat()


def now_iso() -> str:
    return utcnow().isoformat()
