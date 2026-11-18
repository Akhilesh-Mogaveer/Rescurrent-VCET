"""Policy Arena: calendar, reactive first-window and MahaliShield-optimized scheduling,
evaluated on identical initial conditions, scenarios, resources, tasks and constraints.

All outcomes are SIMULATED RESULTS of the conceptual twin, not field evidence.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

import numpy as np

from app.optimization.context import SPH, PlanningContext
from app.optimization.cpsat import diagnose_unscheduled, solve_cpsat
from app.optimization.list_scheduler import ListScheduler, order_with_predecessors
from app.optimization.validator import PlannedTask, validate_plan
from app.simulation.twin import efficacy_matrix, exposure_sum_by_completion, wetness_and_hazard

PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3}

POLICY_INFO = {
    "calendar": {
        "name": "A · Calendar-based",
        "description": "Works through plots in fixed route order (plot code) at the earliest crew shift slot, "
                       "without consulting the rainfall forecast. All resource constraints are enforced.",
    },
    "reactive": {
        "name": "B · Reactive first-window",
        "description": "Plots ordered by coordinator priority then area; each is placed in the first feasible "
                       "approved rainfall break (same window rule as the optimizer) with the earliest available crew.",
    },
    "optimized": {
        "name": "C · MahaliShield optimized",
        "description": "OR-Tools CP-SAT allocates plots, crews and start times to minimise expected weighted "
                       "simulated exposure across the planning rainfall scenarios.",
    },
}


def calendar_policy(ctx: PlanningContext) -> list[PlannedTask]:
    tmap = ctx.task_map
    keys = sorted((t.key for t in ctx.tasks), key=lambda k: (tmap[k].plot_code, tmap[k].affects_protection))
    ls = ListScheduler(ctx, enforce_window=False)
    for k in order_with_predecessors(ctx, keys):
        ls.place(tmap[k], choose="earliest")
    return ls.result()


def reactive_policy(ctx: PlanningContext) -> list[PlannedTask]:
    tmap = ctx.task_map
    keys = sorted((t.key for t in ctx.tasks),
                  key=lambda k: (PRIORITY_RANK.get(tmap[k].priority, 2), -tmap[k].area, tmap[k].plot_code,
                                 tmap[k].affects_protection))
    ls = ListScheduler(ctx, enforce_window=True)
    for k in order_with_predecessors(ctx, keys):
        ls.place(tmap[k], choose="earliest")
    return ls.result()


def _eval_tables(ctx: PlanningContext) -> dict[tuple[int, int], tuple[np.ndarray, np.ndarray]]:
    cache = ctx.meta.get("_eval_tables")
    if cache is not None:
        return cache
    cache = {}
    for t in ctx.tasks:
        if not t.affects_protection:
            continue
        oh = int(math.ceil(t.duration / SPH))
        k = (t.plot_id, oh)
        if k in cache:
            continue
        plot = ctx.plots[t.plot_id]
        _, _, H = wetness_and_hazard(plot, ctx.rain_eval, ctx.params)
        eff = efficacy_matrix(ctx.rain_eval, oh, t.max_rain, t.dry_hours, ctx.params)
        cache[k] = (exposure_sum_by_completion(plot, ctx.rain_eval, H, eff, ctx.params), eff)
    ctx.meta["_eval_tables"] = cache
    return cache


def _feasible_window_exists(rain_s: np.ndarray, ctx: PlanningContext, op_hours: int, dry_hours: int,
                            max_rain: float, from_hour: int) -> bool:
    T = len(rain_s)
    need = op_hours + dry_hours
    run = 0
    for h in range(from_hour, T):
        lh = ctx.local_hour(h * SPH)
        if rain_s[h] <= max_rain:
            run += 1
            # operation must start within working daylight 7-18
            start_h = h - need + 1
            if run >= need and 7 <= ctx.local_hour(start_h * SPH) <= 18 - op_hours:
                return True
        else:
            run = 0
        _ = lh
    return False


def travel_and_work(ctx: PlanningContext, assignments: list[PlannedTask]) -> dict[str, float]:
    by_crew_day: dict[tuple[int, int], list[PlannedTask]] = defaultdict(list)
    for a in assignments:
        by_crew_day[(a.crew_id, ctx.local_day(a.start))].append(a)
    travel = 0
    work = 0
    for (cid, _), lst in by_crew_day.items():
        lst.sort(key=lambda a: a.start)
        prev = f"base:{cid}"
        for a in lst:
            travel += ctx.tt(prev, a.task_key)
            work += a.end - a.start
            prev = a.task_key
    return {"travel_hours": round(travel / SPH, 2), "work_hours": round(work / SPH, 2)}


def evaluate(ctx: PlanningContext, assignments: list[PlannedTask]) -> dict[str, Any]:
    tables = _eval_tables(ctx)
    T = ctx.hours
    S = ctx.rain_eval.shape[0]
    placed = {a.task_key: a for a in assignments}
    weighted = np.zeros(S)
    exposure_hours = np.zeros(S)
    success_count = np.zeros(S)
    acreage = np.zeros(S)
    missed = np.zeros(S)
    disrupted = np.zeros(S)
    prot_tasks = [t for t in ctx.tasks if t.affects_protection]
    per_plot = []
    for t in prot_tasks:
        oh = int(math.ceil(t.duration / SPH))
        expsum, eff = tables[(t.plot_id, oh)]
        plot = ctx.plots[t.plot_id]
        a = placed.get(t.key)
        if a:
            comp = min(T, int(math.ceil(a.end / SPH)))
            e = expsum[:, comp]
            ok = eff[:, comp] >= 0.5 * ctx.params["protection_efficacy"]
            h0, h1 = a.start // SPH, int(math.ceil(a.end / SPH))
            hit = np.any(ctx.rain_eval[:, h0:h1] > t.max_rain, axis=1)
        else:
            e = expsum[:, T]
            ok = np.zeros(S, dtype=bool)
            hit = np.zeros(S, dtype=bool)
        weighted += e * plot.weight
        exposure_hours += e
        success_count += ok
        acreage += ok * plot.area_acres
        disrupted += hit
        if a is None or not ok.all():
            fh = (ctx.now_slot + SPH - 1) // SPH
            for s in range(S):
                if not ok[s] and _feasible_window_exists(ctx.rain_eval[s], ctx, oh, t.dry_hours, t.max_rain, fh):
                    missed[s] += 1
        per_plot.append({
            "task_key": t.key, "plot_id": t.plot_id, "plot_code": t.plot_code,
            "scheduled": a is not None,
            "start_slot": a.start if a else None, "crew_id": a.crew_id if a else None,
            "expected_exposure_hours": round(float(e.mean()), 3),
            "success_rate": round(float(ok.mean()), 3),
        })
    n = max(1, len(prot_tasks))
    k = max(1, int(math.ceil(0.1 * S)))
    tail = float(np.sort(weighted)[-k:].mean())
    tw = travel_and_work(ctx, assignments)
    total_area = sum(ctx.plots[t.plot_id].area_acres for t in prot_tasks)
    return {
        "expected_weighted_exposure": round(float(weighted.mean()), 3),
        "exposure_hours": round(float(exposure_hours.mean()), 3),
        "tail_exposure_cvar90": round(tail, 3),
        "acreage_covered": round(float(acreage.mean()), 3),
        "acreage_total": round(total_area, 3),
        "completion_rate": round(float(success_count.mean() / n), 4),
        "scheduled_tasks": len([a for a in assignments if ctx.task_map[a.task_key].affects_protection]),
        "protective_tasks_total": len(prot_tasks),
        "missed_feasible_windows": round(float(missed.mean()), 3),
        "replanning_disruption": round(float(disrupted.mean()), 3),
        "travel_hours": tw["travel_hours"],
        "work_hours": tw["work_hours"],
        "weighted_exposure_distribution": [round(float(v), 3) for v in weighted],
        "per_plot": per_plot,
    }


METRIC_DEFS = {
    "expected_weighted_exposure": {"label": "Expected weighted exposure", "better": "lower",
                                   "definition": "Mean over evaluation scenarios of Σ plot weight × exposure-hours"},
    "exposure_hours": {"label": "Exposure-hours", "better": "lower",
                       "definition": "Mean over scenarios of Σ unweighted relative exposure index × hours"},
    "tail_exposure_cvar90": {"label": "Tail exposure (CVaR 90%)", "better": "lower",
                             "definition": "Mean weighted exposure of the worst 10% of scenarios"},
    "acreage_covered": {"label": "Acreage covered", "better": "higher",
                        "definition": "Expected acres whose operation executed and was not washed off (simulated)"},
    "completion_rate": {"label": "Schedule completion rate", "better": "higher",
                        "definition": "Expected share of protective tasks executed successfully"},
    "missed_feasible_windows": {"label": "Missed feasible windows", "better": "lower",
                                "definition": "Expected plots left unprotected although the scenario had a workable dry window"},
    "travel_hours": {"label": "Travel time (h)", "better": "lower", "definition": "Crew travel incl. base departures"},
    "work_hours": {"label": "Working time (h)", "better": "neutral", "definition": "Crew hours spent on operations"},
    "replanning_disruption": {"label": "Replanning disruption", "better": "lower",
                              "definition": "Expected number of scheduled tasks hit by rain (would need rescheduling)"},
}


def run_policies(ctx: PlanningContext, time_limit_s: float = 8.0, workers: int = 8, seed: int = 0) -> dict[str, Any]:
    out: dict[str, Any] = {}
    schedules = {
        "calendar": (calendar_policy(ctx), {"engine": "list scheduler", "status": "HEURISTIC"}),
        "reactive": (reactive_policy(ctx), {"engine": "list scheduler", "status": "HEURISTIC"}),
    }
    opt = solve_cpsat(ctx, time_limit_s=time_limit_s, workers=workers, seed=seed)
    schedules["optimized"] = (opt["assignments"], opt["solver"])
    for name, (asg, solver) in schedules.items():
        m = evaluate(ctx, asg)
        v = validate_plan(ctx, asg, enforce_windows=(name != "calendar"))
        out[name] = {
            **POLICY_INFO[name],
            "metrics": m,
            "solver": solver,
            "validation": {"valid": v["valid"],
                           "failed_checks": [c["check"] for c in v["checks"] if not c["passed"]]},
            "assignments": [{"task_key": a.task_key, "crew_id": a.crew_id, "start": a.start, "end": a.end}
                            for a in asg],
            "unscheduled": diagnose_unscheduled(ctx, asg),
        }
    base = out["calendar"]["metrics"]
    for name in out:
        diffs = {}
        for key in METRIC_DEFS:
            b, v = base[key], out[name]["metrics"][key]
            diffs[key] = None if not b else round((v - b) / abs(b) * 100, 2)
        out[name]["pct_vs_calendar"] = diffs
    rb = out["reactive"]["metrics"]
    out["optimized"]["pct_vs_reactive"] = {
        k: (None if not rb[k] else round((out["optimized"]["metrics"][k] - rb[k]) / abs(rb[k]) * 100, 2))
        for k in METRIC_DEFS}
    return out
