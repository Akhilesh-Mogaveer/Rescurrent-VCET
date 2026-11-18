"""Shared list-scheduling heuristic used by the calendar and reactive baselines and by the
greedy fallback of the optimizer. Enforces exactly the same hard resource constraints as the
CP-SAT model and the validator (crew exclusivity + travel, shifts, availability, eligibility,
equipment capacity, daily capacity, precedence, frozen work)."""
from __future__ import annotations

from collections import defaultdict
from typing import Literal

from app.optimization.context import SPH, PlanningContext, TaskCtx, allowed_starts
from app.optimization.validator import PlannedTask


class ListScheduler:
    def __init__(self, ctx: PlanningContext, enforce_window: bool):
        self.ctx = ctx
        self.enforce_window = enforce_window
        self.by_crew: dict[int, list[PlannedTask]] = defaultdict(list)
        self.usage: dict[str, list[int]] = {k: [0] * ctx.slots for k in ctx.equipment_capacity}
        self.day_used: dict[tuple[int, int], int] = defaultdict(int)
        self.placed: dict[str, PlannedTask] = {}
        for k, f in ctx.frozen.items():
            self._commit(PlannedTask(k, f.crew_id, f.start, f.end, frozen=True, status=f.status))

    def _commit(self, a: PlannedTask) -> None:
        self.by_crew[a.crew_id].append(a)
        t = self.ctx.task_map.get(a.task_key)
        if t and t.equipment_type in self.usage:
            for s in range(max(0, a.start), min(self.ctx.slots, a.end)):
                self.usage[t.equipment_type][s] += 1
        self.day_used[(a.crew_id, self.ctx.local_day(a.start))] += a.end - a.start
        self.placed[a.task_key] = a

    def feasible(self, task: TaskCtx, crew_id: int, start: int) -> bool:
        ctx = self.ctx
        end = start + task.duration
        for o in self.by_crew[crew_id]:
            if not (o.end + ctx.tt(o.task_key, task.key) <= start or end + ctx.tt(task.key, o.task_key) <= o.start):
                return False
        if task.equipment_type:
            cap = ctx.equipment_capacity.get(task.equipment_type)
            if cap is None:
                return False
            u = self.usage[task.equipment_type]
            if any(u[s] + 1 > cap[s] for s in range(start, end)):
                return False
        crew = ctx.crew_map[crew_id]
        if self.day_used[(crew_id, ctx.local_day(start))] + task.duration > int(round(crew.max_hours_per_day * SPH)):
            return False
        return True

    def place(self, task: TaskCtx, choose: Literal["earliest", "min_cost"] = "earliest",
              crew_order: list[int] | None = None) -> PlannedTask | None:
        min_start = 0
        if task.predecessor and task.predecessor in self.ctx.task_map:
            pred = self.placed.get(task.predecessor)
            if pred is None:
                return None
            min_start = pred.end
        best: tuple[float, int, int, int] | None = None
        crews = crew_order or [c.id for c in self.ctx.crews]
        for rank, cid in enumerate(crews):
            crew = self.ctx.crew_map[cid]
            for s in allowed_starts(self.ctx, task, crew, self.enforce_window, min_start):
                if not self.feasible(task, cid, s):
                    continue
                key = (float(self.ctx.cost[task.key][s]) if choose == "min_cost" else 0.0, s, rank, cid)
                if best is None or key < best:
                    best = key
                if choose == "earliest":
                    break  # earliest feasible start for this crew found
        if best is None:
            return None
        a = PlannedTask(task.key, best[3], best[1], best[1] + task.duration)
        self._commit(a)
        return a

    def result(self) -> list[PlannedTask]:
        return sorted(self.placed.values(), key=lambda a: (a.start, a.crew_id))


def order_with_predecessors(ctx: PlanningContext, keys: list[str]) -> list[str]:
    """Stable order that inserts each task's predecessor immediately before it if needed."""
    out: list[str] = []
    seen: set[str] = set()
    tmap = ctx.task_map

    def add(k: str) -> None:
        if k in seen or k in ctx.frozen:
            return
        p = tmap[k].predecessor
        if p and p in tmap:
            add(p)
        seen.add(k)
        out.append(k)

    for k in keys:
        add(k)
    return out
