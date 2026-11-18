"""OR-Tools CP-SAT scheduler: assigns plots/tasks to crews and start slots.

Objective: minimise the expected weighted relative exposure (mean over planning rainfall
scenarios) of all plots, where scheduling a protective operation at start slot ``s`` yields
cost ``ctx.cost[task][s]`` and leaving it unscheduled yields ``ctx.unscheduled_cost[task]``.

Hard constraints: (1) crew exclusivity, (2) task duration, (3) crew shifts & unavailability,
(4) equipment availability/capacity over time, (5) travel time between consecutive tasks and
from the crew base, (6) approved operational windows (min dry-window probability), (7) crew
daily working-hour capacity, (8) task precedence, (9) frozen completed / in-progress work.
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model

from app.optimization.context import SPH, PlanningContext, allowed_starts
from app.optimization.list_scheduler import ListScheduler, order_with_predecessors
from app.optimization.validator import PlannedTask

STATUS_NAMES = {
    cp_model.OPTIMAL: "OPTIMAL",
    cp_model.FEASIBLE: "FEASIBLE",
    cp_model.INFEASIBLE: "INFEASIBLE",
    cp_model.MODEL_INVALID: "MODEL_INVALID",
    cp_model.UNKNOWN: "UNKNOWN",
}


def greedy_schedule(ctx: PlanningContext) -> list[PlannedTask]:
    """Cost-aware greedy fallback: highest potential exposure reduction first, min-cost start."""
    benefit = {}
    for t in ctx.tasks:
        if t.key in ctx.frozen:
            continue
        best = int(ctx.cost[t.key].min()) if t.affects_protection else 0
        benefit[t.key] = ctx.unscheduled_cost[t.key] - best
    # Non-protection tasks inherit their successor's benefit so that precedence is honoured
    for t in ctx.tasks:
        if t.predecessor in benefit:
            benefit[t.predecessor] = max(benefit[t.predecessor], benefit.get(t.key, 0))
    keys = sorted(benefit, key=lambda k: -benefit[k])
    ls = ListScheduler(ctx, enforce_window=True)
    tmap = ctx.task_map
    for k in order_with_predecessors(ctx, keys):
        ls.place(tmap[k], choose="min_cost")
    return ls.result()


def diagnose_unscheduled(ctx: PlanningContext, scheduled: list[PlannedTask]) -> list[dict[str, Any]]:
    placed = {a.task_key for a in scheduled}
    tmap = ctx.task_map
    out = []
    for t in ctx.tasks:
        if t.key in placed:
            continue
        reasons: list[str] = []
        eligible = [c for c in ctx.crews if t.code in c.eligibility]
        avail = [c for c in eligible if c.available]
        if not eligible:
            reasons.append(f"No crew is eligible for task type {t.code}")
        elif not avail:
            reasons.append("All eligible crews are unavailable")
        else:
            no_window = [c for c in avail if not allowed_starts(ctx, t, c, enforce_window=False)]
            windows = {c.id: allowed_starts(ctx, t, c, enforce_window=True) for c in avail}
            if len(no_window) == len(avail):
                reasons.append("No crew shift slot fits the task duration within the remaining horizon "
                               "(shift hours, unavailability, equipment or travel from base)")
            elif not any(windows.values()):
                best = float(ctx.window_prob[t.key].max()) if len(ctx.window_prob[t.key]) else 0.0
                reasons.append(f"No approved operational window: best dry-window probability in crew hours is "
                               f"{best:.2f}, below the approved minimum {t.min_prob:.2f}")
            else:
                if t.equipment_type and int(ctx.equipment_capacity.get(t.equipment_type, [0]).max() if
                                            t.equipment_type in ctx.equipment_capacity else 0) == 0:
                    reasons.append(f"No operational '{t.equipment_type}' equipment")
                else:
                    reasons.append("Crew time, equipment capacity and travel are fully used by tasks with larger "
                                   "expected exposure reduction within the approved windows")
        if t.predecessor and t.predecessor in tmap and t.predecessor not in placed:
            reasons.append(f"Predecessor task {t.predecessor} could not be scheduled")
        out.append({
            "task_key": t.key, "task_code": t.code, "plot_id": t.plot_id, "plot_code": t.plot_code,
            "reasons": reasons,
            "exposure_if_unprotected": round(ctx.unscheduled_cost[t.key] / 100, 3),
        })
    return out


def solve_cpsat(ctx: PlanningContext, time_limit_s: float = 10.0, workers: int = 8,
                seed: int = 0, use_hint: bool = True) -> dict[str, Any]:
    t0 = time.perf_counter()
    model = cp_model.CpModel()
    S = ctx.slots
    tmap = ctx.task_map
    crews = ctx.crews

    start: dict[str, Any] = {}
    end: dict[str, Any] = {}
    sched: dict[str, Any] = {}
    x: dict[tuple[str, int], Any] = {}
    allowed: dict[tuple[str, int], list[int]] = {}
    fixed: dict[str, tuple[int, int, int]] = {k: (f.crew_id, f.start, f.end) for k, f in ctx.frozen.items()}
    obj_terms = []
    const_obj = 0

    for t in ctx.tasks:
        if t.key in fixed:
            cid, s0, e0 = fixed[t.key]
            start[t.key], end[t.key], sched[t.key] = s0, e0, 1
            if t.affects_protection:
                const_obj += int(ctx.cost[t.key][min(s0, S - 1)])
            continue
        union: set[int] = set()
        for c in crews:
            al = allowed_starts(ctx, t, c, enforce_window=True)
            if al:
                allowed[(t.key, c.id)] = al
                union.update(al)
        if not union:
            const_obj += ctx.unscheduled_cost[t.key]
            continue
        dom = sorted(union)
        sv = model.NewIntVarFromDomain(cp_model.Domain.FromValues(dom), f"s_{t.key}")
        ev = model.NewIntVar(0, S, f"e_{t.key}")
        model.Add(ev == sv + t.duration)
        b = model.NewBoolVar(f"sched_{t.key}")
        lits = []
        for c in crews:
            if (t.key, c.id) in allowed:
                xv = model.NewBoolVar(f"x_{t.key}_{c.id}")
                x[(t.key, c.id)] = xv
                model.AddLinearExpressionInDomain(sv, cp_model.Domain.FromValues(allowed[(t.key, c.id)])).OnlyEnforceIf(xv)
                lits.append(xv)
        model.Add(sum(lits) == b)
        start[t.key], end[t.key], sched[t.key] = sv, ev, b
        if t.affects_protection:
            table = [int(v) for v in ctx.cost[t.key]]
            cv = model.NewIntVar(min(table), max(table), f"c_{t.key}")
            model.AddElement(sv, table, cv)
            ov = model.NewIntVar(0, max(max(table), ctx.unscheduled_cost[t.key]), f"o_{t.key}")
            model.Add(ov == cv).OnlyEnforceIf(b)
            model.Add(ov == ctx.unscheduled_cost[t.key]).OnlyEnforceIf(b.Not())
            obj_terms.append(ov)

    # Precedence
    for t in ctx.tasks:
        p = t.predecessor
        if not p or p not in tmap or t.key in fixed:
            continue
        if t.key not in sched:
            continue
        if p not in sched:  # predecessor impossible -> successor impossible
            model.Add(sched[t.key] == 0)
            continue
        if p in fixed:
            model.Add(start[t.key] >= end[p]).OnlyEnforceIf(sched[t.key])
        else:
            model.AddImplication(sched[t.key], sched[p])
            model.Add(start[t.key] >= end[p]).OnlyEnforceIf(sched[t.key])

    # Crew exclusivity + travel (pairwise disjunctions) and redundant NoOverlap
    pair_count = 0
    for c in crews:
        members: list[tuple[str, Any]] = []
        intervals = []
        for t in ctx.tasks:
            if t.key in fixed and fixed[t.key][0] == c.id:
                members.append((t.key, True))
                intervals.append(model.NewIntervalVar(start[t.key], end[t.key] - start[t.key], end[t.key], f"fi_{t.key}"))
            elif (t.key, c.id) in x:
                xv = x[(t.key, c.id)]
                members.append((t.key, xv))
                intervals.append(model.NewOptionalIntervalVar(start[t.key], t.duration, end[t.key], xv, f"i_{t.key}_{c.id}"))
        if len(intervals) > 1:
            model.AddNoOverlap(intervals)
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                ki, li = members[i]
                kj, lj = members[j]
                if li is True and lj is True:
                    continue
                enf = [lit for lit in (li, lj) if lit is not True]
                order = model.NewBoolVar(f"o_{ki}_{kj}_{c.id}")
                model.Add(end[ki] + ctx.tt(ki, kj) <= start[kj]).OnlyEnforceIf(enf + [order])
                model.Add(end[kj] + ctx.tt(kj, ki) <= start[ki]).OnlyEnforceIf(enf + [order.Not()])
                pair_count += 1

    # Daily capacity per crew: z[t,d] = task t starts on local day d; w = x[t,c] AND z[t,d]
    days = sorted({ctx.local_day(s) for s in range(S)})
    zday: dict[tuple[str, int], Any] = {}
    single_day: dict[str, int] = {}
    for t in ctx.tasks:
        if t.key in fixed or t.key not in sched:
            continue
        union = sorted({s for c in crews for s in allowed.get((t.key, c.id), [])})
        tdays = sorted({ctx.local_day(s) for s in union})
        if len(tdays) == 1:
            single_day[t.key] = tdays[0]
            continue
        zs = []
        for d in tdays:
            z = model.NewBoolVar(f"z_{t.key}_{d}")
            dom = [s for s in union if ctx.local_day(s) == d]
            model.AddLinearExpressionInDomain(start[t.key], cp_model.Domain.FromValues(dom)).OnlyEnforceIf(z)
            zday[(t.key, d)] = z
            zs.append(z)
        model.AddExactlyOne(zs)
    for c in crews:
        cap = int(round(c.max_hours_per_day * SPH))
        per_day_terms: dict[int, list[Any]] = defaultdict(list)
        per_day_const: dict[int, int] = defaultdict(int)
        for t in ctx.tasks:
            if t.key in fixed:
                if fixed[t.key][0] == c.id:
                    per_day_const[ctx.local_day(fixed[t.key][1])] += fixed[t.key][2] - fixed[t.key][1]
                continue
            if (t.key, c.id) not in x:
                continue
            xv = x[(t.key, c.id)]
            if t.key in single_day:
                per_day_terms[single_day[t.key]].append(t.duration * xv)
                continue
            for d in days:
                z = zday.get((t.key, d))
                if z is None:
                    continue
                w = model.NewBoolVar(f"w_{t.key}_{c.id}_{d}")
                model.AddImplication(w, xv)
                model.AddImplication(w, z)
                model.AddBoolOr([w, xv.Not(), z.Not()])
                per_day_terms[d].append(t.duration * w)
        for d in days:
            if per_day_terms[d]:
                model.Add(sum(per_day_terms[d]) + per_day_const[d] <= max(cap, per_day_const[d]))

    # Equipment capacity (time-varying capacity via fixed blocking intervals)
    for etype, capa in ctx.equipment_capacity.items():
        fu = [0] * S
        ivs, dem = [], []
        for t in ctx.tasks:
            if t.equipment_type != etype:
                continue
            if t.key in fixed:
                s0, e0 = fixed[t.key][1], fixed[t.key][2]
                for s in range(max(0, s0), min(S, e0)):
                    fu[s] += 1
                if e0 > s0:
                    ivs.append(model.NewIntervalVar(s0, e0 - s0, e0, f"fe_{t.key}"))
                    dem.append(1)
            elif t.key in sched:
                ivs.append(model.NewOptionalIntervalVar(start[t.key], t.duration, end[t.key], sched[t.key], f"eq_{t.key}"))
                dem.append(1)
        if not ivs:
            continue
        C = max(int(capa.max()), max(fu))
        s = 0
        while s < S:
            red = C - max(int(capa[s]), fu[s])
            e = s
            while e < S and C - max(int(capa[e]), fu[e]) == red:
                e += 1
            if red > 0:
                ivs.append(model.NewIntervalVar(s, e - s, e, f"blk_{etype}_{s}"))
                dem.append(red)
            s = e
        model.AddCumulative(ivs, dem, C)

    model.Minimize(sum(obj_terms) + const_obj)

    hint_used = False
    if use_hint:
        try:
            g = greedy_schedule(ctx)
            gmap = {a.task_key: a for a in g}
            for t in ctx.tasks:
                if t.key in fixed or t.key not in sched:
                    continue
                a = gmap.get(t.key)
                model.AddHint(sched[t.key], 1 if a else 0)
                if a:
                    model.AddHint(start[t.key], a.start)
                for c in crews:
                    if (t.key, c.id) in x:
                        model.AddHint(x[(t.key, c.id)], 1 if a and a.crew_id == c.id else 0)
            hint_used = True
        except Exception:  # pragma: no cover - hint is optional
            hint_used = False

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit_s)
    solver.parameters.num_search_workers = max(1, workers)
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    elapsed = time.perf_counter() - t0
    name = STATUS_NAMES.get(status, str(status))

    info: dict[str, Any] = {
        "engine": "OR-Tools CP-SAT",
        "status": name,
        "solve_time_s": round(solver.WallTime(), 3),
        "total_time_s": round(elapsed, 3),
        "time_limit_s": time_limit_s,
        "workers": workers,
        "seed": seed,
        "variables": len(model.Proto().variables),
        "constraints": len(model.Proto().constraints),
        "crew_pair_disjunctions": pair_count,
        "hint_from_greedy": hint_used,
        "fallback_used": False,
    }
    assignments: list[PlannedTask] = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        info["objective"] = round(solver.ObjectiveValue() / 100, 3)
        info["best_bound"] = round(solver.BestObjectiveBound() / 100, 3)
        obj = solver.ObjectiveValue()
        info["gap"] = round(abs(obj - solver.BestObjectiveBound()) / max(1.0, abs(obj)), 5)
        info["optimality_claim"] = "proven optimal" if status == cp_model.OPTIMAL else \
            "feasible solution found within time limit; optimality NOT proven"
        for t in ctx.tasks:
            if t.key in fixed:
                f = ctx.frozen[t.key]
                assignments.append(PlannedTask(t.key, f.crew_id, f.start, f.end, frozen=True, status=f.status))
                continue
            if t.key not in sched or not solver.Value(sched[t.key]):
                continue
            cid = next(c.id for c in crews if (t.key, c.id) in x and solver.Value(x[(t.key, c.id)]))
            s0 = solver.Value(start[t.key])
            assignments.append(PlannedTask(t.key, cid, s0, s0 + t.duration))
    else:
        info["optimality_claim"] = "no solver solution"
        if status == cp_model.INFEASIBLE:
            info["infeasibility"] = ("Hard constraints are contradictory, typically because frozen (completed or "
                                     "in-progress) work conflicts with updated capacity or availability.")
        g = greedy_schedule(ctx)
        frozen_pt = [PlannedTask(k, f.crew_id, f.start, f.end, frozen=True, status=f.status) for k, f in ctx.frozen.items()]
        assignments = [a for a in g]
        present = {a.task_key for a in assignments}
        assignments += [f for f in frozen_pt if f.task_key not in present]
        info["fallback_used"] = True
        info["fallback"] = "greedy list scheduler (cost-aware)"
        info["status"] = f"{name} -> GREEDY_FALLBACK"
        info["objective"] = round(objective_of(ctx, assignments) / 100, 3)
    assignments.sort(key=lambda a: (a.start, a.crew_id))
    return {"solver": info, "assignments": assignments}


def objective_of(ctx: PlanningContext, assignments: list[PlannedTask]) -> int:
    placed = {a.task_key: a for a in assignments}
    total = 0
    for t in ctx.tasks:
        if not t.affects_protection:
            continue
        a = placed.get(t.key)
        total += int(ctx.cost[t.key][min(a.start, ctx.slots - 1)]) if a else ctx.unscheduled_cost[t.key]
    return total
