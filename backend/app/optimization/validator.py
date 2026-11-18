"""Independent plan validator.

Deliberately re-implements every hard constraint check from first principles (it does not
reuse solver variables) so that any plan — optimized, heuristic, or replanned — is verified
by the same rules before it is saved or published.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from app.optimization.context import SPH, PlanningContext, crew_slot_ok


@dataclass
class PlannedTask:
    task_key: str
    crew_id: int
    start: int
    end: int
    frozen: bool = False
    status: str = "planned"


def validate_plan(ctx: PlanningContext, assignments: list[PlannedTask],
                  enforce_windows: bool = True) -> dict[str, Any]:
    tasks = ctx.task_map
    crews = ctx.crew_map
    checks: dict[str, list[str]] = {k: [] for k in (
        "known_entities", "horizon", "task_duration", "crew_exclusivity_travel", "crew_availability",
        "crew_eligibility", "equipment_capacity", "approved_windows", "crew_daily_capacity",
        "precedence", "frozen_immutability", "single_assignment")}

    seen: set[str] = set()
    for a in assignments:
        if a.task_key in seen:
            checks["single_assignment"].append(f"{a.task_key} assigned more than once")
        seen.add(a.task_key)
        if a.task_key not in tasks or a.crew_id not in crews:
            checks["known_entities"].append(f"{a.task_key}/crew {a.crew_id} not in planning context")
    valid = [a for a in assignments if a.task_key in tasks and a.crew_id in crews]

    for a in valid:
        t, c = tasks[a.task_key], crews[a.crew_id]
        fixed = ctx.frozen.get(a.task_key)
        if a.start < 0 or a.end > ctx.slots:
            checks["horizon"].append(f"{a.task_key} outside horizon [{a.start},{a.end})")
        if not fixed and a.start < ctx.now_slot:
            checks["horizon"].append(f"{a.task_key} starts before current time (slot {a.start} < {ctx.now_slot})")
        expected = (fixed.end - fixed.start) if fixed else t.duration
        if a.end - a.start != expected:
            checks["task_duration"].append(f"{a.task_key} duration {a.end - a.start} slots != required {expected}")
        if fixed:
            if (fixed.crew_id, fixed.start, fixed.end) != (a.crew_id, a.start, a.end):
                checks["frozen_immutability"].append(f"{a.task_key} was {fixed.status} and must not change")
            continue  # historical work is not re-checked against new availability
        if t.code not in c.eligibility:
            checks["crew_eligibility"].append(f"{c.code} not eligible for {t.code}")
        if not c.available:
            checks["crew_availability"].append(f"{c.code} is unavailable")
        bad = [s for s in range(a.start, a.end) if not crew_slot_ok(ctx, c, s)]
        if bad:
            checks["crew_availability"].append(f"{a.task_key} on {c.code} outside shift/availability at slot {bad[0]}")
        if ctx.local_hour(a.start) < c.shift_start + ctx.tt(f"base:{c.id}", a.task_key) / SPH:
            checks["crew_availability"].append(f"{a.task_key}: no time to travel from {c.code} base after shift start")
        if ctx.local_day(a.start) != ctx.local_day(a.end - 1):
            checks["crew_availability"].append(f"{a.task_key} spans two working days")
        if enforce_windows and ctx.window_prob[a.task_key][a.start] + 1e-9 < t.min_prob:
            checks["approved_windows"].append(
                f"{a.task_key} window probability {ctx.window_prob[a.task_key][a.start]:.2f} < approved minimum {t.min_prob:.2f}")

    # Frozen tasks must all be present
    present = {a.task_key for a in valid}
    for k, f in ctx.frozen.items():
        if k not in present:
            checks["frozen_immutability"].append(f"{k} ({f.status}) missing from plan")

    # Crew exclusivity incl. travel
    by_crew: dict[int, list[PlannedTask]] = defaultdict(list)
    for a in valid:
        by_crew[a.crew_id].append(a)
    for cid, lst in by_crew.items():
        lst.sort(key=lambda x: x.start)
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                p, q = lst[i], lst[j]
                if p.frozen and q.frozen:
                    continue
                need = ctx.tt(p.task_key, q.task_key)
                if p.end + need > q.start:
                    checks["crew_exclusivity_travel"].append(
                        f"{crews[cid].code}: {p.task_key} (ends {p.end}) + travel {need} overlaps {q.task_key} (starts {q.start})")
        # daily capacity
        per_day: dict[int, int] = defaultdict(int)
        for a in lst:
            per_day[ctx.local_day(a.start)] += a.end - a.start
        cap = int(round(crews[cid].max_hours_per_day * SPH))
        for d, used in per_day.items():
            if used > cap and not all(x.frozen for x in lst if ctx.local_day(x.start) == d):
                checks["crew_daily_capacity"].append(f"{crews[cid].code} day {d}: {used / SPH:.2f} h > {cap / SPH:.2f} h")

    # Equipment capacity per slot
    usage: dict[str, list[int]] = {k: [0] * ctx.slots for k in ctx.equipment_capacity}
    for a in valid:
        et = tasks[a.task_key].equipment_type
        if not et:
            continue
        if et not in usage:
            checks["equipment_capacity"].append(f"{a.task_key} needs '{et}' but none registered")
            continue
        for s in range(max(0, a.start), min(ctx.slots, a.end)):
            usage[et][s] += 1
    for et, arr in usage.items():
        capa = ctx.equipment_capacity[et]
        for s, u in enumerate(arr):
            if u > capa[s]:
                frozen_only = all(ctx.frozen.get(a.task_key) for a in valid
                                  if tasks[a.task_key].equipment_type == et and a.start <= s < a.end)
                if not frozen_only:
                    checks["equipment_capacity"].append(f"'{et}' usage {u} > capacity {int(capa[s])} at slot {s}")
                    break

    # Precedence
    amap = {a.task_key: a for a in valid}
    for a in valid:
        pred = tasks[a.task_key].predecessor
        if pred and pred in tasks:
            if pred not in amap:
                checks["precedence"].append(f"{a.task_key} scheduled but predecessor {pred} is not")
            elif amap[pred].end > a.start:
                checks["precedence"].append(f"{a.task_key} starts before predecessor {pred} ends")

    results = [{"check": k, "passed": not v, "violations": v[:20], "violation_count": len(v)} for k, v in checks.items()]
    return {"valid": all(r["passed"] for r in results), "checks": results,
            "assignment_count": len(assignments)}
