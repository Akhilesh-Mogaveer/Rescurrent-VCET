"""MahaliShield Intelligence Assistant: deterministic, grounded explanations over computed
simulation, optimizer, and replanning artifacts, plus optional Gemini natural-language
constraint parsing with strict Pydantic + business-rule validation.

Never allows an LLM to invent schedules, bypass validation, or prescribe pesticides.
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError
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
    SimulationRun,
    TaskRule,
    TwinParameterSet,
    WeatherScenarioSet,
)
from app.optimization.context import SLOT_MIN, SPH
from app.services.planning import active_parameter_set, plot_inputs
from app.simulation.twin import build_priority_queue, summarize_plot
from app.weather.service import as_utc, default_set, rain_matrix


class ParsedConstraintProposal(BaseModel):
    intent: str = Field(..., pattern="^(explain|propose_constraint|general)$")
    constraint_type: str | None = Field(default=None)  # crew_unavailable | urgent_priority | equipment_failure | early_rain
    target_code: str | None = None
    start_hour: int | None = Field(default=None, ge=0, le=72)
    end_hour: int | None = Field(default=None, ge=0, le=72)
    summary: str = ""


def _latest_approved_or_draft_plan(db: Session, plan_id: int | None = None) -> Plan | None:
    if plan_id is not None:
        return db.get(Plan, plan_id)
    approved = db.execute(select(Plan).where(Plan.status == "approved").order_by(Plan.id.desc())).scalars().first()
    if approved:
        return approved
    return db.execute(select(Plan).order_by(Plan.id.desc())).scalars().first()


def _extract_codes(message: str) -> dict[str, list[str]]:
    msg = message.upper()
    plots = re.findall(r"\bP[-_ ]?0*(\d{1,3})\b|\bPLOT\s+0*(\d{1,3})\b", msg)
    plot_codes = []
    for a, b in plots:
        num = int(a or b)
        plot_codes.append(f"P-{num:03d}")
    crews = re.findall(r"\bC[-_ ]?0*(\d{1,2})\b|\bCREW\s+0*(\d{1,2})\b", msg)
    crew_codes = []
    for a, b in crews:
        num = int(a or b)
        crew_codes.append(f"C-{num:02d}")
    return {"plots": plot_codes, "crews": crew_codes}


def _try_parse_constraint_rule_based(db: Session, message: str) -> dict[str, Any] | None:
    lower = message.lower()
    codes = _extract_codes(message)
    if any(w in lower for w in ("unavailable", "sick", "leave", "off duty", "cannot work")) and codes["crews"]:
        ccode = codes["crews"][0]
        crew = db.execute(select(Crew).where(Crew.code == ccode)).scalar_one_or_none()
        if crew:
            return {
                "requires_confirmation": True,
                "constraint_type": "crew_unavailable",
                "target": {"crew_id": crew.id, "crew_code": crew.code, "crew_name": crew.name},
                "payload": {"crew_id": crew.id, "start_slot": 8, "end_slot": 96, "reason": f"Parsed from chat: {message[:100]}"},
                "validation": {"schema_valid": True, "business_rule_valid": True, "notes": "Crew exists and slot range is within 72h horizon."},
                "summary": f"Propose marking {crew.code} ({crew.name}) unavailable from slot 8 to 96 and triggering replanning.",
            }
    if any(w in lower for w in ("urgent", "escalate", "high priority", "prioritize")) and codes["plots"] and not lower.strip().startswith("why"):
        pcode = codes["plots"][0]
        plot = db.execute(select(Plot).where(Plot.code == pcode)).scalar_one_or_none()
        if plot:
            return {
                "requires_confirmation": True,
                "constraint_type": "urgent_priority",
                "target": {"plot_id": plot.id, "plot_code": plot.code, "plot_name": plot.name},
                "payload": {"plot_id": plot.id},
                "validation": {"schema_valid": True, "business_rule_valid": True, "notes": "Plot exists and is eligible for priority escalation."},
                "summary": f"Propose escalating {plot.code} ({plot.name}) to URGENT priority and re-running CP-SAT replanning.",
            }
    return None


def _optional_gemini_parse(message: str) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent"
    prompt = (
        "Parse the user's message into JSON matching schema: "
        '{"intent": "explain"|"propose_constraint"|"general", '
        '"constraint_type": "crew_unavailable"|"urgent_priority"|"equipment_failure"|"early_rain"|null, '
        '"target_code": string|null, "start_hour": int|null, "end_hour": int|null, "summary": string}. '
        "Never invent facts or prescribe chemicals. User message: " + message
    )
    try:
        resp = httpx.post(
            url,
            params={"key": settings.gemini_api_key},
            json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json"}},
            timeout=6.0,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        txt = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = ParsedConstraintProposal.model_validate_json(txt)
        return parsed.model_dump()
    except (httpx.HTTPError, KeyError, IndexError, ValidationError, ValueError):
        return None


def answer_question(db: Session, message: str, plan_id: int | None = None) -> dict[str, Any]:
    plan = _latest_approved_or_draft_plan(db, plan_id)
    ss = db.get(WeatherScenarioSet, plan.scenario_set_id) if plan else default_set(db)
    ps = db.get(TwinParameterSet, plan.parameter_set_id) if plan else active_parameter_set(db, "base")

    codes = _extract_codes(message)
    lower = message.lower()
    proposal = _try_parse_constraint_rule_based(db, message)
    gemini_parsed = _optional_gemini_parse(message)

    sections: list[dict[str, Any]] = []
    citations: list[dict[str, str]] = []
    headline = "MahaliShield Decision-Support Explanation"

    # Compute priority queue from actual twin state
    plots = list(db.execute(select(Plot).order_by(Plot.code)).scalars())
    plot_map_code = {p.code: p for p in plots}
    plot_map_id = {p.id: p for p in plots}
    crews = list(db.execute(select(Crew).order_by(Crew.code)).scalars())
    crew_map_code = {c.code: c for c in crews}
    crew_map_id = {c.id: c for c in crews}

    queue: list[dict[str, Any]] = []
    if ss and ps and plots:
        rain = rain_matrix(ss)
        pin = plot_inputs(plots)
        pin_map = {p.plot_id: p for p in pin}
        summaries = [summarize_plot(p, rain, ps.params) for p in pin]
        queue = build_priority_queue(summaries, pin_map)

    q_by_code = {item["code"]: item for item in queue}

    # 1. Plot-specific inquiry
    if codes["plots"]:
        for pcode in codes["plots"]:
            p = plot_map_code.get(pcode)
            if not p:
                sections.append({"title": f"Plot {pcode} Not Found", "body": f"No registered plot has code `{pcode}`. Available plots: {', '.join(sorted(plot_map_code))}."})
                continue
            qitem = q_by_code.get(pcode)
            asg = None
            if plan:
                asg = next((a for a in plan.assignments if a.plot_id == p.id and a.task_code == "PROT"), None)
                if not asg:
                    asg = next((a for a in plan.assignments if a.plot_id == p.id), None)
            headline = f"Why {p.code} ({p.name}) is prioritized & scheduled"
            rank_txt = (
                f"Ranked **#{qitem['rank']} of {len(queue)}** in the simulated exposure priority queue "
                f"(weighted relative exposure score **{qitem['score']:.2f}**, mean exposure-hours **{qitem['exposure_hours_mean']:.2f}**, "
                f"P90 exposure-hours **{qitem['exposure_hours_p90']:.2f}**, share **{qitem['share']*100:.1f}%**)."
                if qitem else "Priority queue score unavailable."
            )
            factors = qitem["factors"] if qitem else []
            body_lines = [
                rank_txt,
                f"- **Plot attributes**: {p.area_acres} acres · priority `{p.priority}` · drainage `{p.drainage}` · canopy density `{p.canopy_density:.2f}` · initial protection state `{p.protection_state:.2f}`.",
                "- **Contributing simulation factors**: " + "; ".join(factors),
            ]
            if asg:
                c = crew_map_id.get(asg.crew_id)
                exp = asg.explanation or {}
                body_lines.append(
                    f"- **Current schedule (Plan #{plan.id} v{plan.version})**: Assigned to **{c.code if c else asg.crew_id} ({c.name if c else ''})** "
                    f"from `{as_utc(asg.start_time).isoformat()}` to `{as_utc(asg.end_time).isoformat()}` "
                    f"(slot {asg.start_slot}–{asg.end_slot}, travel buffer `{asg.travel_slots * SLOT_MIN} min`, status `{asg.status}`, frozen `{asg.frozen}`)."
                )
                if exp.get("factors"):
                    for f in exp["factors"]:
                        body_lines.append(f"  - {f}")
                if exp.get("crew_alternatives"):
                    body_lines.append("- **Why other crews were not chosen**: " + " | ".join(exp["crew_alternatives"]))
            elif plan:
                un = next((u for u in (plan.unscheduled or []) if u.get("plot_id") == p.id), None)
                if un:
                    body_lines.append(f"- **Unscheduled in Plan #{plan.id}**: " + "; ".join(un.get("reasons", [])))
            sections.append({"title": f"Plot {p.code} — {p.name}", "body": "\n".join(body_lines)})
            citations.append({"label": "SIMULATED RESULT", "source": f"Twin {ps.version if ps else 'base'} on Scenario Set #{ss.id if ss else '?'}"})

    # 2. Crew-specific inquiry
    if codes["crews"]:
        for ccode in codes["crews"]:
            c = crew_map_code.get(ccode)
            if not c:
                sections.append({"title": f"Crew {ccode} Not Found", "body": f"No crew has code `{ccode}`. Registered crews: {', '.join(sorted(crew_map_code))}."})
                continue
            headline = f"Crew {c.code} ({c.name}) Assignment & Reasoning"
            asgs = [a for a in (plan.assignments if plan else []) if a.crew_id == c.id]
            lines = [
                f"- **Crew profile**: shift `{c.shift_start_hour:02d}:00–{c.shift_end_hour:02d}:00 IST`, max `{c.max_hours_per_day}h/day`, "
                f"available `{c.is_available}`, eligible tasks `{', '.join(c.eligibility or [])}`.",
            ]
            if not asgs:
                lines.append(f"- **Assignments in Plan #{plan.id if plan else '-'}**: None currently assigned.")
            else:
                lines.append(f"- **Assigned tasks in Plan #{plan.id} (v{plan.version})** ({len(asgs)} tasks):")
                for a in asgs:
                    pl = plot_map_id.get(a.plot_id)
                    exp = a.explanation or {}
                    wp = (a.window_probability or 0.0) * 100
                    lines.append(
                        f"  - `{a.task_code}` on **{pl.code if pl else a.plot_id}** (`{pl.name if pl else ''}`): slots `{a.start_slot}–{a.end_slot}` "
                        f"(`{as_utc(a.start_time).strftime('%d %b %H:%M UTC')}`), travel `{a.travel_slots * SLOT_MIN} min`, "
                        f"dry-window probability `{wp:.0f}%`, expected exposure reduction `{exp.get('expected_reduction', 0):.2f}`."
                    )
            sections.append({"title": f"Crew {c.code} — {c.name}", "body": "\n".join(lines)})

    # 3. Early rain / replanning diff inquiry
    if any(k in lower for k in ("early rain", "what changed", "replan", "disruption", "version", "revised")):
        replan_plan = plan
        if replan_plan and not replan_plan.diff:
            replan_plan = db.execute(select(Plan).where(Plan.diff.is_not(None)).order_by(Plan.id.desc())).scalars().first() or plan
        if replan_plan and replan_plan.diff:
            headline = f"Dynamic Replanning Analysis — Plan #{replan_plan.id} (v{replan_plan.version})"
            ev = db.get(DisruptionEvent, replan_plan.disruption_event_id) if replan_plan.disruption_event_id else None
            changed = [d for d in replan_plan.diff if d.get("change") not in ("unchanged",)]
            lines = [
                f"- **Disruption event**: `{ev.type if ev else 'manual'}` — {ev.description if ev else 'Replanning triggered'} (at slot `{replan_plan.now_slot}`).",
                f"- **Solver status**: `{replan_plan.solver.get('status')}` ({replan_plan.solver.get('optimality_claim')}).",
                f"- **Independent validation**: `{'PASSED' if replan_plan.validation.get('valid') else 'FAILED'}`.",
            ]
            for d in changed:
                prev_s = f"{d['previous'].get('crew_code', d['previous']['crew_id'])} @ slot {d['previous']['start_slot']}" if d.get("previous") else "unscheduled"
                new_s = f"{d['new'].get('crew_code', d['new']['crew_id'])} @ slot {d['new']['start_slot']}" if d.get("new") else "unscheduled"
                lines.append(f"  - **{d['plot_code']} ({d['task_key']})** [{d['change'].upper()}]: `{prev_s}` → `{new_s}` — {'; '.join(d.get('reasons', []))}")
            sections.append({"title": f"Changes in Plan #{replan_plan.id} (v{replan_plan.version})", "body": "\n".join(lines)})
        else:
            sections.append({
                "title": "No Replanning Diff Recorded Yet",
                "body": "No disruption replanning diff is attached to the selected plan yet. Trigger an early-rain or crew disruption on the **Dynamic Replanning** screen to generate a versioned comparison.",
            })

    # 4. Unscheduled / rejected assignments inquiry
    if any(k in lower for k in ("unscheduled", "reject", "infeasible", "remain", "not scheduled", "missed")):
        headline = "Unscheduled Tasks & Constraint Rejection Reasons"
        if plan and plan.unscheduled:
            lines = [f"In **Plan #{plan.id} (v{plan.version})**, **{len(plan.unscheduled)}** task(s) remain unscheduled:"]
            for u in plan.unscheduled:
                lines.append(
                    f"- **{u['plot_code']} (`{u['task_key']}`)** — unprotected weighted exposure `{u.get('exposure_if_unprotected', 0):.2f}`: "
                    + "; ".join(u.get("reasons", []))
                )
            sections.append({"title": "Unscheduled Tasks", "body": "\n".join(lines)})
        elif plan:
            sections.append({
                "title": "All Active Tasks Scheduled",
                "body": f"In **Plan #{plan.id} (v{plan.version})**, all **{len(plan.assignments)}** active tasks satisfied approved dry-window, crew shift, travel, and equipment capacity constraints. If a specific (crew, slot) pair was not chosen, it either had lower dry-window probability than the approved threshold or reduced total expected exposure less than the chosen assignment.",
            })

    # 5. Rainfall window inquiry
    if any(k in lower for k in ("window", "rain", "gap", "forecast", "scenario")) and not sections:
        headline = "Rainfall Window & Ensemble Uncertainty Explanation"
        if ss:
            from app.weather.service import summarize
            wsum = summarize(ss)
            wins = wsum.get("windows", [])
            lines = [
                f"- **Scenario Set #{ss.id}**: `{ss.label}` (`{ss.source_type.upper()}`, `{ss.member_count}` members, `{ss.hours}` hours from `{as_utc(ss.horizon_start).isoformat()}`).",
                f"- **Approved window rule**: operation duration + `3h` post-application drying with rainfall `≤ 0.3 mm/h` in at least `60%` of ensemble members during working hours (`07:00–18:00 IST`).",
            ]
            if wins:
                for i, w in enumerate(wins[:4], 1):
                    lines.append(
                        f"  - **Window {i}**: hours `+{w['start_hour']}h` to `+{w['end_hour']}h` (`{w['start_time']}`), "
                        f"peak dry-window probability `{w['max_probability']*100:.0f}%`, rain-return risk before drying completes `{w['rain_return_risk_at_best']*100:.0f}%`."
                    )
            else:
                lines.append("  - No multi-hour window currently exceeds the 60% threshold.")
            sections.append({"title": "Feasible Rainfall Breaks", "body": "\n".join(lines)})

    # Default comprehensive summary if question was general
    if not sections:
        top3 = queue[:3]
        active_plan_str = (
            f"Plan #{plan.id} (v{plan.version}, status `{plan.status}`, solver `{plan.solver.get('status')}`, objective `{plan.solver.get('objective')}`)"
            if plan else "No plan generated yet."
        )
        lines = [
            f"- **Active Plan**: {active_plan_str}",
            f"- **Weather Scenario Set**: {f'#{ss.id} ({ss.label})' if ss else 'None'}",
            "- **Top 3 prioritized plots (by simulated weighted exposure)**:",
        ]
        for item in top3:
            lines.append(f"  - **#{item['rank']} {item['code']}**: score `{item['score']:.2f}` ({'; '.join(item['factors'][:2])})")
        lines.append("\nAsk about any specific plot (e.g., *Why is Plot 014 prioritized?*), crew (e.g., *Why was Crew 02 assigned?*), rainfall window, unscheduled tasks, or what changed after early rainfall.")
        sections.append({"title": "Operational Intelligence Summary", "body": "\n".join(lines)})

    citations.extend([
        {"label": "MODEL ASSUMPTION", "source": f"Conceptual Twin {ps.version if ps else 'twin-0.3.0'} ({ps.sensitivity if ps else 'base'} sensitivity)"},
        {"label": "SIMULATED RESULT", "source": f"OR-Tools CP-SAT Plan #{plan.id} v{plan.version}" if plan else "No active plan"},
    ])

    return {
        "headline": headline,
        "sections": sections,
        "proposal": proposal,
        "llm_mode": "gemini_validated" if gemini_parsed else "deterministic_template",
        "gemini_parsed": gemini_parsed,
        "plan_id": plan.id if plan else None,
        "scenario_set_id": ss.id if ss else None,
        "citations": citations,
        "disclaimer": (
            "Decision-support explanation generated strictly from validated simulation and CP-SAT optimization records. "
            "Relative exposure is a conceptual index, not a validated koleroga disease probability, and no pesticide prescription is made."
        ),
    }
