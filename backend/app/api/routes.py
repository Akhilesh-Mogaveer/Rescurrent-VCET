"""REST API v1 router implementing all MahaliShield endpoints."""
from __future__ import annotations

import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.assistant.service import answer_question
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_coordinator, require_role
from app.core.security import create_access_token, hash_password, verify_password
from app.models import (
    Assignment,
    AuditLog,
    Crew,
    DisruptionEvent,
    Equipment,
    ExpertFeedback,
    Farm,
    Notification,
    Plan,
    Plot,
    PolicyResult,
    SimulationRun,
    TaskRule,
    TwinParameterSet,
    User,
    WeatherScenarioSet,
    utcnow,
)
from app.optimization.context import SLOT_MIN
from app.policies.arena import METRIC_DEFS, run_policies
from app.schemas.api import (
    AssistantChatRequest,
    CrewCreate,
    CrewUpdate,
    DisruptionCreateRequest,
    EquipmentCreate,
    EquipmentUpdate,
    ExpertFeedbackCreate,
    FarmCreate,
    ForgotPasswordRequest,
    LoginRequest,
    OptimizeRequest,
    ParameterUpdateRequest,
    PlotCreate,
    PlotUpdate,
    PolicyCompareRequest,
    RegisterRequest,
    ReplanRequest,
    ResetPasswordRequest,
    SimulationRequest,
    TaskRuleUpdate,
    TokenResponse,
    UserOut,
    UserUpdateRequest,
)
from app.services.audit import audit, notify
from app.services.planning import (
    active_parameter_set,
    apply_disruption_overrides,
    build_from_db,
    diff_plans,
    frozen_from_plan,
    mark_progress,
    persist_plan,
    plot_inputs,
    run_policy,
)
from app.simulation.twin import (
    BASE_PARAMS,
    MODEL_VERSION,
    PARAM_DOCS,
    build_priority_queue,
    input_hash,
    summarize_plot,
)
from app.weather.openmeteo import WeatherFetchError
from app.weather.service import (
    as_utc,
    create_synthetic_set,
    default_set,
    last_error,
    rain_matrix,
    refresh_live,
    set_meta,
    summarize,
)

router = APIRouter(prefix="/api/v1")


def _serialize_plot(p: Plot, farm_map: dict[int, Farm], crew_map: dict[int, Crew], exp_map: dict[int, dict] | None = None) -> dict[str, Any]:
    f = farm_map.get(p.farm_id)
    c = crew_map.get(p.assigned_crew_id) if p.assigned_crew_id else None
    sim = (exp_map or {}).get(p.id)
    return {
        "id": p.id,
        "code": p.code,
        "farm_id": p.farm_id,
        "farm_name": f.name if f else "Cooperative Cluster",
        "grower_name": f.grower_name if f else None,
        "name": p.name,
        "lat": p.lat,
        "lon": p.lon,
        "area_acres": p.area_acres,
        "priority": p.priority,
        "status": p.status,
        "drainage": p.drainage,
        "canopy_density": p.canopy_density,
        "protection_state": p.protection_state,
        "inspection_required": p.inspection_required,
        "assigned_crew_id": p.assigned_crew_id,
        "assigned_crew_code": c.code if c else None,
        "assigned_crew_name": c.name if c else None,
        "notes": p.notes,
        "is_synthetic": p.is_synthetic,
        "updated_at": as_utc(p.updated_at).isoformat(),
        "simulated_exposure": sim,
    }


def _serialize_plan(plan: Plan, db: Session, include_assignments: bool = True) -> dict[str, Any]:
    plots = {p.id: p for p in db.execute(select(Plot)).scalars()}
    crews = {c.id: c for c in db.execute(select(Crew)).scalars()}
    ss = db.get(WeatherScenarioSet, plan.scenario_set_id)
    ps = db.get(TwinParameterSet, plan.parameter_set_id)
    out: dict[str, Any] = {
        "id": plan.id,
        "name": plan.name,
        "lineage_id": plan.lineage_id or plan.id,
        "version": plan.version,
        "parent_plan_id": plan.parent_plan_id,
        "status": plan.status,
        "policy": plan.policy,
        "scenario_set_id": plan.scenario_set_id,
        "scenario_set_label": ss.label if ss else None,
        "scenario_source_type": ss.source_type if ss else None,
        "parameter_set_id": plan.parameter_set_id,
        "parameter_version": ps.version if ps else None,
        "simulation_run_id": plan.simulation_run_id,
        "horizon_start": as_utc(plan.horizon_start).isoformat(),
        "horizon_hours": plan.horizon_hours,
        "now_slot": plan.now_slot,
        "context": plan.context,
        "solver": plan.solver,
        "validation": plan.validation,
        "unscheduled": plan.unscheduled or [],
        "metrics": plan.metrics or {},
        "diff": plan.diff,
        "disruption_event_id": plan.disruption_event_id,
        "created_at": as_utc(plan.created_at).isoformat(),
        "approved_at": as_utc(plan.approved_at).isoformat() if plan.approved_at else None,
    }
    if include_assignments:
        asgs = []
        for a in plan.assignments:
            pl = plots.get(a.plot_id)
            cr = crews.get(a.crew_id)
            asgs.append({
                "id": a.id,
                "task_key": a.task_key,
                "task_code": a.task_code,
                "plot_id": a.plot_id,
                "plot_code": pl.code if pl else str(a.plot_id),
                "plot_name": pl.name if pl else "",
                "plot_area_acres": pl.area_acres if pl else 0.0,
                "plot_priority": pl.priority if pl else "medium",
                "crew_id": a.crew_id,
                "crew_code": cr.code if cr else str(a.crew_id),
                "crew_name": cr.name if cr else "",
                "equipment_type": a.equipment_type,
                "start_slot": a.start_slot,
                "end_slot": a.end_slot,
                "duration_minutes": (a.end_slot - a.start_slot) * SLOT_MIN,
                "travel_slots": a.travel_slots,
                "travel_minutes": a.travel_slots * SLOT_MIN,
                "start_time": as_utc(a.start_time).isoformat(),
                "end_time": as_utc(a.end_time).isoformat(),
                "status": a.status,
                "frozen": a.frozen,
                "window_probability": a.window_probability,
                "expected_exposure": a.expected_exposure,
                "exposure_if_unprotected": a.exposure_if_unprotected,
                "explanation": a.explanation,
            })
        out["assignments"] = asgs
    return out


# ===========================================================================
# 1. AUTHENTICATION & USERS
# ===========================================================================

@router.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_user(req: RegisterRequest, db: Session = Depends(get_db)):
    exists = db.execute(select(User).where(User.email == req.email.lower())).scalar_one_or_none()
    if exists:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")
    u = User(
        email=req.email.lower(),
        full_name=req.full_name,
        hashed_password=hash_password(req.password),
        role=req.role,
        language=req.language,
        phone=req.phone,
        preferences={"units": "metric", "timezone": "Asia/Kolkata", "notifications_enabled": True},
    )
    db.add(u)
    db.flush()
    audit(db, "auth.register", "user", u.id, f"Registered user {u.email} ({u.role})", u, commit=True)
    token = create_access_token(str(u.id), u.role)
    return TokenResponse(access_token=token, user=UserOut.model_validate(u))


@router.post("/auth/login", response_model=TokenResponse)
def login_user(req: LoginRequest, db: Session = Depends(get_db)):
    u = db.execute(select(User).where(User.email == req.email.lower())).scalar_one_or_none()
    if not u or not verify_password(req.password, u.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not u.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User account is disabled")
    audit(db, "auth.login", "user", u.id, f"User {u.email} logged in", u, commit=True)
    token = create_access_token(str(u.id), u.role)
    return TokenResponse(access_token=token, user=UserOut.model_validate(u))


@router.post("/auth/token", response_model=TokenResponse)
def login_form(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    return login_user(LoginRequest(email=form.username, password=form.password), db)


@router.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    u = db.execute(select(User).where(User.email == req.email.lower())).scalar_one_or_none()
    if not u:
        return {"message": "If the email is registered, a password reset token has been generated.", "demo_reset_token": None}
    tok = secrets.token_hex(4).upper()
    u.reset_token = tok
    u.reset_token_expires = datetime.now(timezone.utc) + timedelta(minutes=30)
    audit(db, "auth.forgot_password", "user", u.id, f"Password reset requested for {u.email}", u, commit=True)
    return {
        "message": "Password reset code generated (displayed here for offline/demo evaluation since no SMTP server is configured).",
        "demo_reset_token": tok,
        "expires_in_minutes": 30,
    }


@router.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    u = db.execute(select(User).where(User.email == req.email.lower())).scalar_one_or_none()
    if not u or not u.reset_token or u.reset_token != req.reset_token.strip().upper():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid reset token")
    if u.reset_token_expires and as_utc(u.reset_token_expires) < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reset token expired")
    u.hashed_password = hash_password(req.new_password)
    u.reset_token = None
    u.reset_token_expires = None
    audit(db, "auth.reset_password", "user", u.id, f"Password reset completed for {u.email}", u, commit=True)
    return {"message": "Password updated successfully. You may now sign in."}


@router.get("/auth/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


@router.put("/auth/me", response_model=UserOut)
def update_me(req: UserUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if req.full_name is not None:
        user.full_name = req.full_name
    if req.language is not None:
        user.language = req.language
    if req.phone is not None:
        user.phone = req.phone
    if req.preferences is not None:
        user.preferences = {**(user.preferences or {}), **req.preferences}
    audit(db, "user.update_profile", "user", user.id, f"Updated profile/preferences for {user.email}", user, commit=True)
    return UserOut.model_validate(user)


@router.get("/users")
def list_users(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = list(db.execute(select(User).order_by(User.id)).scalars())
    return [UserOut.model_validate(u).model_dump() for u in users]


@router.put("/users/{user_id}/role")
def change_user_role(user_id: int, role: str = Query(..., pattern="^(farmer|coordinator|admin)$"),
                     admin_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    target.role = role
    audit(db, "user.role_change", "user", target.id, f"Role changed to {role} by {admin_user.email}", admin_user, commit=True)
    return UserOut.model_validate(target)


# ===========================================================================
# 2. DASHBOARD OVERVIEW
# ===========================================================================

@router.get("/dashboard/summary")
def dashboard_summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    farms = list(db.execute(select(Farm)).scalars())
    plots = list(db.execute(select(Plot).order_by(Plot.code)).scalars())
    crews = list(db.execute(select(Crew).order_by(Crew.code)).scalars())
    equipment = list(db.execute(select(Equipment).order_by(Equipment.code)).scalars())
    ss = default_set(db)
    ps = active_parameter_set(db, "base")
    latest_sim = db.execute(select(SimulationRun).order_by(SimulationRun.id.desc()).limit(1)).scalar_one_or_none()
    active_plan = db.execute(select(Plan).where(Plan.status == "approved").order_by(Plan.id.desc()).limit(1)).scalar_one_or_none()
    if not active_plan:
        active_plan = db.execute(select(Plan).order_by(Plan.id.desc()).limit(1)).scalar_one_or_none()

    exp_map: dict[int, dict] = {}
    queue: list[dict] = []
    if latest_sim and latest_sim.results:
        for s in latest_sim.results.get("summaries", []):
            exp_map[s["plot_id"]] = {
                "exposure_hours_mean": s["exposure_hours_mean"],
                "exposure_hours_p90": s["exposure_hours_p90"],
                "weighted_exposure_mean": s["weighted_exposure_mean"],
                "mean_wetness": s["mean_wetness"],
                "current_protection": s["current_protection"],
            }
        queue = latest_sim.results.get("priority_queue", [])
    elif ss and ps and plots:
        rain = rain_matrix(ss)
        pin = plot_inputs(plots)
        summaries = [summarize_plot(p, rain, ps.params) for p in pin]
        for s in summaries:
            exp_map[s["plot_id"]] = {
                "exposure_hours_mean": s["exposure_hours_mean"],
                "exposure_hours_p90": s["exposure_hours_p90"],
                "weighted_exposure_mean": s["weighted_exposure_mean"],
                "mean_wetness": s["mean_wetness"],
                "current_protection": s["current_protection"],
            }
        queue = build_priority_queue(summaries, {p.plot_id: p for p in pin})

    wsum = summarize(ss) if ss else None
    farm_map = {f.id: f for f in farms}
    crew_map = {c.id: c for c in crews}
    recent_logs = list(db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(10)).scalars())

    return {
        "counts": {
            "total_farms": len(farms),
            "total_plots": len(plots),
            "total_acres": round(sum(p.area_acres for p in plots), 2),
            "active_crews": sum(1 for c in crews if c.is_available),
            "total_crews": len(crews),
            "operational_equipment": sum(1 for e in equipment if e.status == "operational" and e.is_available),
            "pending_operations": sum(1 for p in plots if p.status in ("pending", "scheduled")),
            "plots_requiring_attention": sum(1 for q in queue if q["exposure_hours_mean"] >= 12.0 or plot_map_priority(plots, q["plot_id"]) in ("high", "urgent")),
        },
        "weather": {
            "meta": wsum["meta"] if wsum else None,
            "next_dry_window": wsum["next_dry_window"] if wsum else None,
            "windows": (wsum["windows"][:4] if wsum else []),
            "totals": wsum["totals"] if wsum else None,
            "current_median_rain_mm": wsum["percentiles"]["p50"][0] if wsum and wsum["percentiles"]["p50"] else 0.0,
        },
        "latest_simulation": {
            "id": latest_sim.id if latest_sim else None,
            "model_version": latest_sim.model_version if latest_sim else MODEL_VERSION,
            "created_at": as_utc(latest_sim.created_at).isoformat() if latest_sim else None,
        },
        "active_plan": _serialize_plan(active_plan, db, include_assignments=True) if active_plan else None,
        "priority_queue": queue,
        "plots": [_serialize_plot(p, farm_map, crew_map, exp_map) for p in plots],
        "recent_activity": [
            {
                "id": log.id,
                "created_at": as_utc(log.created_at).isoformat(),
                "user_email": log.user_email,
                "action": log.action,
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "summary": log.summary,
            }
            for log in recent_logs
        ],
    }


def plot_map_priority(plots: list[Plot], plot_id: int) -> str:
    for p in plots:
        if p.id == plot_id:
            return p.priority
    return "medium"


# ===========================================================================
# 3. FARMS & PLOTS CRUD
# ===========================================================================

@router.get("/farms")
def list_farms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    farms = list(db.execute(select(Farm).order_by(Farm.id)).scalars())
    return [
        {
            "id": f.id, "name": f.name, "village": f.village, "owner_id": f.owner_id,
            "grower_name": f.grower_name, "lat": f.lat, "lon": f.lon, "is_synthetic": f.is_synthetic,
        }
        for f in farms
    ]


@router.post("/farms", status_code=status.HTTP_201_CREATED)
def create_farm(req: FarmCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    f = Farm(
        name=req.name, village=req.village, owner_id=user.id if user.role == "farmer" else None,
        grower_name=req.grower_name or user.full_name, lat=req.lat, lon=req.lon, is_synthetic=req.is_synthetic,
    )
    db.add(f)
    db.flush()
    audit(db, "farm.create", "farm", f.id, f"Created farm {f.name}", user, commit=True)
    return {"id": f.id, "name": f.name, "village": f.village, "grower_name": f.grower_name, "lat": f.lat, "lon": f.lon, "is_synthetic": f.is_synthetic}


@router.get("/plots")
def list_plots(
    search: str | None = None,
    priority: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    farms = {f.id: f for f in db.execute(select(Farm)).scalars()}
    crews = {c.id: c for c in db.execute(select(Crew)).scalars()}
    latest_sim = db.execute(select(SimulationRun).order_by(SimulationRun.id.desc()).limit(1)).scalar_one_or_none()
    exp_map = {}
    if latest_sim and latest_sim.results:
        for s in latest_sim.results.get("summaries", []):
            exp_map[s["plot_id"]] = s
    plots = list(db.execute(select(Plot).order_by(Plot.code)).scalars())
    out = []
    for p in plots:
        if priority and p.priority != priority:
            continue
        if status_filter and p.status != status_filter:
            continue
        if search:
            q = search.lower()
            fname = farms.get(p.farm_id).name.lower() if p.farm_id in farms else ""
            if q not in p.code.lower() and q not in p.name.lower() and q not in fname:
                continue
        out.append(_serialize_plot(p, farms, crews, exp_map))
    return out


@router.post("/plots", status_code=status.HTTP_201_CREATED)
def create_plot(req: PlotCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    code = req.code.strip().upper()
    if db.execute(select(Plot).where(Plot.code == code)).scalar_one_or_none():
        raise HTTPException(400, f"Plot code {code} already exists")
    fid = req.farm_id
    if not fid:
        if req.farm_name:
            f = Farm(name=req.farm_name, grower_name=user.full_name, owner_id=user.id, lat=req.lat, lon=req.lon, is_synthetic=False)
            db.add(f)
            db.flush()
            fid = f.id
        else:
            first_farm = db.execute(select(Farm).order_by(Farm.id).limit(1)).scalar_one_or_none()
            if not first_farm:
                first_farm = Farm(name="Default Cooperative Farm", grower_name=user.full_name, lat=req.lat, lon=req.lon)
                db.add(first_farm)
                db.flush()
            fid = first_farm.id
    p = Plot(
        code=code, farm_id=fid, name=req.name, lat=req.lat, lon=req.lon, area_acres=req.area_acres,
        priority=req.priority, status=req.status, drainage=req.drainage, canopy_density=req.canopy_density,
        protection_state=req.protection_state, inspection_required=req.inspection_required,
        assigned_crew_id=req.assigned_crew_id, notes=req.notes, is_synthetic=False,
    )
    db.add(p)
    db.flush()
    audit(db, "plot.create", "plot", p.id, f"Created plot {p.code} ({p.name}, {p.area_acres} ac)", user, commit=True)
    farms = {f.id: f for f in db.execute(select(Farm)).scalars()}
    crews = {c.id: c for c in db.execute(select(Crew)).scalars()}
    return _serialize_plot(p, farms, crews)


@router.get("/plots/{plot_id}")
def get_plot(plot_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Plot, plot_id)
    if not p:
        raise HTTPException(404, "Plot not found")
    farms = {f.id: f for f in db.execute(select(Farm)).scalars()}
    crews = {c.id: c for c in db.execute(select(Crew)).scalars()}
    return _serialize_plot(p, farms, crews)


@router.put("/plots/{plot_id}")
def update_plot(plot_id: int, req: PlotUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Plot, plot_id)
    if not p:
        raise HTTPException(404, "Plot not found")
    for field in ("name", "farm_id", "lat", "lon", "area_acres", "priority", "status", "drainage",
                  "canopy_density", "protection_state", "inspection_required", "assigned_crew_id", "notes"):
        val = getattr(req, field)
        if val is not None:
            setattr(p, field, val)
    audit(db, "plot.update", "plot", p.id, f"Updated plot {p.code}", user, commit=True)
    farms = {f.id: f for f in db.execute(select(Farm)).scalars()}
    crews = {c.id: c for c in db.execute(select(Crew)).scalars()}
    return _serialize_plot(p, farms, crews)


@router.delete("/plots/{plot_id}")
def delete_plot(plot_id: int, user: User = Depends(require_role("coordinator", "farmer")), db: Session = Depends(get_db)):
    p = db.get(Plot, plot_id)
    if not p:
        raise HTTPException(404, "Plot not found")
    code = p.code
    db.delete(p)
    audit(db, "plot.delete", "plot", plot_id, f"Deleted plot {code}", user, commit=True)
    return {"deleted": True, "plot_id": plot_id, "code": code}


# ===========================================================================
# 4. CREWS, EQUIPMENT & TASK RULES
# ===========================================================================

@router.get("/crews")
def list_crews(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    crews = list(db.execute(select(Crew).order_by(Crew.code)).scalars())
    active_plan = db.execute(select(Plan).where(Plan.status == "approved").order_by(Plan.id.desc()).limit(1)).scalar_one_or_none()
    if not active_plan:
        active_plan = db.execute(select(Plan).order_by(Plan.id.desc()).limit(1)).scalar_one_or_none()
    counts: dict[int, int] = {}
    if active_plan:
        for a in active_plan.assignments:
            counts[a.crew_id] = counts.get(a.crew_id, 0) + 1
    return [
        {
            "id": c.id, "code": c.code, "name": c.name, "leader": c.leader, "size": c.size,
            "is_available": c.is_available, "shift_start_hour": c.shift_start_hour, "shift_end_hour": c.shift_end_hour,
            "max_hours_per_day": c.max_hours_per_day, "eligibility": c.eligibility or [],
            "base_lat": c.base_lat, "base_lon": c.base_lon, "unavailable_periods": c.unavailable_periods or [],
            "current_assignment": c.current_assignment, "scheduled_task_count": counts.get(c.id, 0),
            "is_synthetic": c.is_synthetic,
        }
        for c in crews
    ]


@router.post("/crews", status_code=status.HTTP_201_CREATED)
def create_crew(req: CrewCreate, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    code = req.code.strip().upper()
    if db.execute(select(Crew).where(Crew.code == code)).scalar_one_or_none():
        raise HTTPException(400, f"Crew {code} already exists")
    c = Crew(
        code=code, name=req.name, leader=req.leader, size=req.size, is_available=req.is_available,
        shift_start_hour=req.shift_start_hour, shift_end_hour=req.shift_end_hour,
        max_hours_per_day=req.max_hours_per_day, eligibility=req.eligibility, base_lat=req.base_lat,
        base_lon=req.base_lon, unavailable_periods=req.unavailable_periods, is_synthetic=False,
    )
    db.add(c)
    db.flush()
    audit(db, "crew.create", "crew", c.id, f"Created crew {c.code} ({c.name})", user, commit=True)
    return {"id": c.id, "code": c.code, "name": c.name, "is_available": c.is_available}


@router.put("/crews/{crew_id}")
def update_crew(crew_id: int, req: CrewUpdate, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    c = db.get(Crew, crew_id)
    if not c:
        raise HTTPException(404, "Crew not found")
    for field in ("name", "leader", "size", "is_available", "shift_start_hour", "shift_end_hour",
                  "max_hours_per_day", "eligibility", "base_lat", "base_lon", "unavailable_periods", "current_assignment"):
        val = getattr(req, field)
        if val is not None:
            setattr(c, field, val)
    if req.is_available is False:
        notify(db, "crew_unavailable", f"Crew {c.code} Marked Unavailable",
               f"{c.code} ({c.name}) was marked unavailable. Re-run optimization or dynamic replanning if they had pending tasks.",
               "warning", "coordinator", "/replanning")
    audit(db, "crew.update", "crew", c.id, f"Updated crew {c.code} (available={c.is_available})", user, commit=True)
    return {
        "id": c.id, "code": c.code, "name": c.name, "leader": c.leader, "size": c.size,
        "is_available": c.is_available, "shift_start_hour": c.shift_start_hour, "shift_end_hour": c.shift_end_hour,
        "max_hours_per_day": c.max_hours_per_day, "eligibility": c.eligibility or [],
        "base_lat": c.base_lat, "base_lon": c.base_lon, "unavailable_periods": c.unavailable_periods or [],
        "current_assignment": c.current_assignment, "is_synthetic": c.is_synthetic,
    }


@router.get("/equipment")
def list_equipment(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    eq = list(db.execute(select(Equipment).order_by(Equipment.code)).scalars())
    return [
        {
            "id": e.id, "code": e.code, "type": e.type, "name": e.name, "capacity": e.capacity,
            "status": e.status, "is_available": e.is_available, "notes": e.notes, "is_synthetic": e.is_synthetic,
        }
        for e in eq
    ]


@router.post("/equipment", status_code=status.HTTP_201_CREATED)
def create_equipment(req: EquipmentCreate, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    code = req.code.strip().upper()
    if db.execute(select(Equipment).where(Equipment.code == code)).scalar_one_or_none():
        raise HTTPException(400, f"Equipment {code} already exists")
    e = Equipment(code=code, type=req.type, name=req.name, capacity=req.capacity, status=req.status,
                  is_available=req.is_available, notes=req.notes, is_synthetic=False)
    db.add(e)
    db.flush()
    audit(db, "equipment.create", "equipment", e.id, f"Added equipment {e.code} ({e.name})", user, commit=True)
    return {"id": e.id, "code": e.code, "type": e.type, "name": e.name, "capacity": e.capacity, "status": e.status, "is_available": e.is_available}


@router.put("/equipment/{eq_id}")
def update_equipment(eq_id: int, req: EquipmentUpdate, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    e = db.get(Equipment, eq_id)
    if not e:
        raise HTTPException(404, "Equipment not found")
    for field in ("name", "type", "capacity", "status", "is_available", "notes"):
        val = getattr(req, field)
        if val is not None:
            setattr(e, field, val)
    if e.status == "failed" or not e.is_available:
        notify(db, "equipment_failure", f"Equipment {e.code} Status: {e.status.upper()}",
               f"{e.code} ({e.name}) is now {e.status}. Available {e.type} capacity is reduced.",
               "critical", "coordinator", "/replanning")
    audit(db, "equipment.update", "equipment", e.id, f"Updated equipment {e.code} (status={e.status})", user, commit=True)
    return {"id": e.id, "code": e.code, "type": e.type, "name": e.name, "capacity": e.capacity, "status": e.status, "is_available": e.is_available, "notes": e.notes}


@router.get("/task-rules")
def list_task_rules(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rules = list(db.execute(select(TaskRule).order_by(TaskRule.id)).scalars())
    return [
        {
            "id": r.id, "code": r.code, "name": r.name, "description": r.description,
            "setup_minutes": r.setup_minutes, "minutes_per_acre": r.minutes_per_acre,
            "required_equipment_type": r.required_equipment_type, "requires_dry_window": r.requires_dry_window,
            "max_rain_mm_per_hour": r.max_rain_mm_per_hour, "dry_hours_after": r.dry_hours_after,
            "min_window_probability": r.min_window_probability, "predecessor_code": r.predecessor_code,
            "applies_to": r.applies_to, "affects_protection": r.affects_protection,
            "is_active": r.is_active, "approved_by": r.approved_by, "evidence_label": r.evidence_label,
        }
        for r in rules
    ]


@router.put("/task-rules/{rule_id}")
def update_task_rule(rule_id: int, req: TaskRuleUpdate, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    r = db.get(TaskRule, rule_id)
    if not r:
        raise HTTPException(404, "Task rule not found")
    for field in ("setup_minutes", "minutes_per_acre", "max_rain_mm_per_hour", "dry_hours_after", "min_window_probability", "is_active"):
        val = getattr(req, field)
        if val is not None:
            setattr(r, field, val)
    audit(db, "task_rule.update", "task_rule", r.id, f"Updated task rule {r.code}", user, commit=True)
    return {"id": r.id, "code": r.code, "setup_minutes": r.setup_minutes, "minutes_per_acre": r.minutes_per_acre,
            "max_rain_mm_per_hour": r.max_rain_mm_per_hour, "dry_hours_after": r.dry_hours_after,
            "min_window_probability": r.min_window_probability, "is_active": r.is_active}


@router.get("/resources/conflicts")
def detect_resource_conflicts(plan_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id) if plan_id else db.execute(select(Plan).order_by(Plan.id.desc()).limit(1)).scalar_one_or_none()
    crews = {c.id: c for c in db.execute(select(Crew)).scalars()}
    eqs = list(db.execute(select(Equipment)).scalars())
    conflicts: list[dict[str, Any]] = []
    if plan:
        for a in plan.assignments:
            c = crews.get(a.crew_id)
            if c and not c.is_available and not a.frozen:
                conflicts.append({
                    "type": "crew_unavailable",
                    "severity": "critical",
                    "task_key": a.task_key,
                    "crew_code": c.code,
                    "detail": f"Task {a.task_key} in Plan #{plan.id} is assigned to {c.code}, who is currently marked unavailable.",
                })
        cap_by_type: dict[str, int] = {}
        for e in eqs:
            if e.status == "operational" and e.is_available:
                cap_by_type[e.type] = cap_by_type.get(e.type, 0) + e.capacity
        for etype, cap in cap_by_type.items():
            for s in range(plan.horizon_hours * 4):
                concurrent = [a for a in plan.assignments if a.equipment_type == etype and a.start_slot <= s < a.end_slot]
                if len(concurrent) > cap:
                    conflicts.append({
                        "type": "equipment_overallocated",
                        "severity": "critical",
                        "equipment_type": etype,
                        "slot": s,
                        "detail": f"{len(concurrent)} tasks require '{etype}' at slot {s}, but current operational capacity is {cap}.",
                    })
                    break
    return {"plan_id": plan.id if plan else None, "conflict_count": len(conflicts), "conflicts": conflicts}


# ===========================================================================
# 5. WEATHER & RAIN-GAP TWIN
# ===========================================================================

@router.get("/forecast/status")
def forecast_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sets = list(db.execute(select(WeatherScenarioSet).order_by(WeatherScenarioSet.id.desc()).limit(15)).scalars())
    active = default_set(db)
    return {
        "active_set": set_meta(active) if active else None,
        "available_sets": [set_meta(s) for s in sets],
        "last_fetch_error": last_error(),
    }


@router.get("/forecast/scenarios")
def get_forecast_scenarios(
    set_id: int | None = None,
    op_hours: int = Query(default=2, ge=1, le=8),
    dry_hours: int = Query(default=3, ge=0, le=12),
    max_rain: float = Query(default=0.3, ge=0.0, le=10.0),
    min_prob: float = Query(default=0.6, ge=0.1, le=0.99),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ss = db.get(WeatherScenarioSet, set_id) if set_id else default_set(db)
    if not ss:
        raise HTTPException(404, "No weather scenario set available")
    return summarize(ss, op_hours=op_hours, dry_hours=dry_hours, max_rain=max_rain, min_prob=min_prob)


@router.post("/forecast/refresh")
def trigger_live_forecast_refresh(
    lat: float | None = None,
    lon: float | None = None,
    model: str | None = None,
    user: User = Depends(require_coordinator),
    db: Session = Depends(get_db),
):
    try:
        ss = refresh_live(db, user=user, lat=lat, lon=lon, model=model)
        return {"refreshed": True, "fallback_active": False, "scenario_set": set_meta(ss)}
    except WeatherFetchError as exc:
        fallback = default_set(db)
        return {
            "refreshed": False,
            "fallback_active": True,
            "error": str(exc),
            "scenario_set": set_meta(fallback) if fallback else None,
        }


@router.post("/forecast/synthetic")
def generate_new_synthetic_scenarios(
    seed: int = Query(default=42, ge=1, le=999999),
    members: int = Query(default=30, ge=5, le=60),
    wetness: float = Query(default=1.0, ge=0.3, le=2.5),
    user: User = Depends(require_coordinator),
    db: Session = Depends(get_db),
):
    ss = create_synthetic_set(
        db, seed=seed, members=members, wetness=wetness,
        label=f"SYNTHETIC Ensemble · seed {seed} · wetness {wetness}x ({members} members)",
    )
    audit(db, "weather.synthetic_created", "weather_scenario_set", ss.id, f"Created synthetic scenario set #{ss.id} (seed={seed})", user, commit=True)
    return set_meta(ss)


# ===========================================================================
# 6. AGRICULTURAL RISK & PROTECTION TWIN SIMULATION
# ===========================================================================

@router.post("/simulations")
def execute_simulation(req: SimulationRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t0 = time.perf_counter()
    ss = db.get(WeatherScenarioSet, req.scenario_set_id) if req.scenario_set_id else default_set(db)
    if not ss:
        raise HTTPException(404, "Weather scenario set not found")
    ps = active_parameter_set(db, req.sensitivity)
    params = dict(ps.params)
    if req.custom_params:
        for k, v in req.custom_params.items():
            if k in BASE_PARAMS:
                params[k] = float(v)
    plots = list(db.execute(select(Plot).order_by(Plot.code)).scalars())
    rain = rain_matrix(ss)
    pinputs = plot_inputs(plots)
    pin_map = {p.plot_id: p for p in pinputs}
    summaries = [summarize_plot(p, rain, params) for p in pinputs]
    queue = build_priority_queue(summaries, pin_map)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    ih = input_hash({"ss": ss.id, "ps": ps.id, "params": params, "plots": [(p.id, p.protection_state, p.priority) for p in plots]})
    sim = SimulationRun(
        scenario_set_id=ss.id,
        parameter_set_id=ps.id,
        model_version=ps.version,
        seed=req.seed,
        created_by=user.id,
        input_hash=ih,
        results={"summaries": summaries, "priority_queue": queue, "params_used": params},
        duration_ms=elapsed_ms,
    )
    db.add(sim)
    db.flush()
    audit(db, "simulation.run", "simulation_run", sim.id,
          f"Executed twin simulation #{sim.id} ({ps.version}, scenario set #{ss.id}) in {elapsed_ms} ms", user, commit=True)
    return _format_simulation(sim, ss, ps)


@router.get("/simulations")
def list_simulations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    runs = list(db.execute(select(SimulationRun).order_by(SimulationRun.id.desc()).limit(20)).scalars())
    return [
        {
            "id": r.id, "scenario_set_id": r.scenario_set_id, "parameter_set_id": r.parameter_set_id,
            "model_version": r.model_version, "input_hash": r.input_hash, "duration_ms": r.duration_ms,
            "created_at": as_utc(r.created_at).isoformat(),
        }
        for r in runs
    ]


@router.get("/simulations/{sim_id}")
def get_simulation(sim_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sim = db.get(SimulationRun, sim_id)
    if not sim:
        raise HTTPException(404, "Simulation run not found")
    ss = db.get(WeatherScenarioSet, sim.scenario_set_id)
    ps = db.get(TwinParameterSet, sim.parameter_set_id)
    return _format_simulation(sim, ss, ps)


def _format_simulation(sim: SimulationRun, ss: WeatherScenarioSet | None, ps: TwinParameterSet | None) -> dict[str, Any]:
    return {
        "id": sim.id,
        "scenario_set": set_meta(ss) if ss else None,
        "parameter_set": {
            "id": ps.id if ps else None,
            "name": ps.name if ps else None,
            "version": sim.model_version,
            "sensitivity": ps.sensitivity if ps else "base",
            "params": (sim.results or {}).get("params_used") or (ps.params if ps else BASE_PARAMS),
            "validation_status": ps.validation_status if ps else "unvalidated",
        },
        "input_hash": sim.input_hash,
        "duration_ms": sim.duration_ms,
        "created_at": as_utc(sim.created_at).isoformat(),
        "summaries": (sim.results or {}).get("summaries", []),
        "priority_queue": (sim.results or {}).get("priority_queue", []),
        "scientific_disclaimer": (
            "CONCEPTUAL MODEL STRUCTURE ONLY: Wetness W(t), Hazard H(t), Protection P(t), and Relative Exposure E(t) = H(t)*(1-P(t)) "
            "are dimensionless relative decision-support indices in [0, 1]. Never interpret E(t) as a calibrated koleroga disease probability."
        ),
    }


# ===========================================================================
# 7. MATHEMATICAL OPTIMIZATION & PLANS
# ===========================================================================

@router.post("/plans/optimize")
def optimize_schedule(req: OptimizeRequest, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    ss = db.get(WeatherScenarioSet, req.scenario_set_id) if req.scenario_set_id else default_set(db)
    if not ss:
        raise HTTPException(404, "Weather scenario set not found")
    ps = active_parameter_set(db, req.sensitivity)
    ctx = build_from_db(db, ss, ps, now_slot=req.now_slot)
    asg, solver = run_policy(ctx, req.policy, time_limit=req.time_limit_s, seed=req.seed)
    plan_name = req.name or f"MahaliShield {req.policy.capitalize()} Plan ({ps.sensitivity})"
    plan = persist_plan(
        db, ctx, asg, solver,
        name=plan_name, scenario_set=ss, param_set=ps, user=user, policy=req.policy,
    )
    notify(db, "new_plan", f"New Schedule Generated: Plan #{plan.id}",
           f"Plan #{plan.id} ({plan.name}) solved with status {solver.get('status')} and {len(asg)} assignments.",
           "info", "coordinator", "/gantt")
    audit(db, "plan.optimize", "plan", plan.id,
          f"Generated Plan #{plan.id} ({req.policy}, solver={solver.get('status')}, objective={solver.get('objective')})",
          user, {"solver": solver, "valid": plan.validation.get("valid")}, commit=True)
    return _serialize_plan(plan, db, include_assignments=True)


@router.get("/plans")
def list_plans(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plans = list(db.execute(select(Plan).order_by(Plan.id.desc()).limit(25)).scalars())
    return [_serialize_plan(p, db, include_assignments=False) for p in plans]


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    return _serialize_plan(plan, db, include_assignments=True)


@router.post("/plans/{plan_id}/approve")
def approve_plan(plan_id: int, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    if not (plan.validation or {}).get("valid", False):
        raise HTTPException(400, "Cannot approve a plan that failed independent constraint validation")
    # Supersede previously approved plans
    for other in db.execute(select(Plan).where(Plan.status == "approved")).scalars():
        if other.id != plan.id:
            other.status = "superseded"
    plan.status = "approved"
    plan.approved_by = user.id
    plan.approved_at = utcnow()
    # Update plot assigned crew indicators
    for a in plan.assignments:
        if a.task_code == "PROT":
            pl = db.get(Plot, a.plot_id)
            if pl:
                pl.assigned_crew_id = a.crew_id
                if pl.status == "pending":
                    pl.status = "scheduled"
    notify(db, "plan_approved", f"Plan #{plan.id} (v{plan.version}) Approved & Published",
           f"Coordinator {user.full_name} approved Plan #{plan.id} ({plan.name}). Farmers and crews can now view updated windows.",
           "success", "all", "/gantt")
    audit(db, "plan.approve", "plan", plan.id, f"Approved Plan #{plan.id} v{plan.version}", user, commit=True)
    return _serialize_plan(plan, db, include_assignments=True)


@router.get("/plans/{plan_id}/versions")
def get_plan_versions(plan_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    lid = plan.lineage_id or plan.id
    versions = list(db.execute(select(Plan).where((Plan.lineage_id == lid) | (Plan.id == lid)).order_by(Plan.version)).scalars())
    return [_serialize_plan(v, db, include_assignments=True) for v in versions]


# ===========================================================================
# 8. POLICY ARENA
# ===========================================================================

@router.post("/policies/compare")
def compare_scheduling_policies(req: PolicyCompareRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t0 = time.perf_counter()
    ss = db.get(WeatherScenarioSet, req.scenario_set_id) if req.scenario_set_id else default_set(db)
    if not ss:
        raise HTTPException(404, "Weather scenario set not found")
    ps = active_parameter_set(db, req.sensitivity)
    ctx = build_from_db(db, ss, ps, now_slot=0, evaluation_mode=req.evaluation_mode)
    res = run_policies(ctx, time_limit_s=req.time_limit_s, seed=req.seed)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    pr = PolicyResult(
        scenario_set_id=ss.id,
        parameter_set_id=ps.id,
        config={"sensitivity": req.sensitivity, "evaluation_mode": req.evaluation_mode, "seed": req.seed},
        results=res,
        created_by=user.id,
        duration_ms=elapsed_ms,
    )
    db.add(pr)
    db.flush()
    audit(db, "policy.compare", "policy_result", pr.id,
          f"Compared Calendar, Reactive, and Optimized policies (#{pr.id}, mode={req.evaluation_mode})", user, commit=True)
    return _format_policy_result(pr, ss, ps)


@router.get("/policies/results")
def list_policy_results(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.execute(select(PolicyResult).order_by(PolicyResult.id.desc()).limit(10)).scalars())
    if not rows:
        return []
    return [
        {
            "id": r.id, "scenario_set_id": r.scenario_set_id, "parameter_set_id": r.parameter_set_id,
            "config": r.config, "duration_ms": r.duration_ms, "created_at": as_utc(r.created_at).isoformat(),
        }
        for r in rows
    ]


@router.get("/policies/results/{result_id}")
def get_policy_result(result_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = db.get(PolicyResult, result_id)
    if not pr:
        raise HTTPException(404, "Policy comparison result not found")
    ss = db.get(WeatherScenarioSet, pr.scenario_set_id)
    ps = db.get(TwinParameterSet, pr.parameter_set_id)
    return _format_policy_result(pr, ss, ps)


def _format_policy_result(pr: PolicyResult, ss: WeatherScenarioSet | None, ps: TwinParameterSet | None) -> dict[str, Any]:
    return {
        "id": pr.id,
        "scenario_set": set_meta(ss) if ss else None,
        "parameter_version": ps.version if ps else MODEL_VERSION,
        "sensitivity": ps.sensitivity if ps else "base",
        "config": pr.config,
        "metric_definitions": METRIC_DEFS,
        "policies": pr.results,
        "duration_ms": pr.duration_ms,
        "created_at": as_utc(pr.created_at).isoformat(),
        "evidence_label": "SIMULATED RESULT",
    }


# ===========================================================================
# 9. DYNAMIC REPLANNING & DISRUPTIONS
# ===========================================================================

@router.get("/disruptions")
def list_disruptions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    evs = list(db.execute(select(DisruptionEvent).order_by(DisruptionEvent.id.desc()).limit(30)).scalars())
    return [
        {
            "id": e.id, "type": e.type, "plan_id": e.plan_id, "occurs_at_slot": e.occurs_at_slot,
            "payload": e.payload, "description": e.description, "resulting_plan_id": e.resulting_plan_id,
            "is_example": e.is_example, "created_at": as_utc(e.created_at).isoformat(),
        }
        for e in evs
    ]


@router.post("/disruptions", status_code=status.HTTP_201_CREATED)
def create_disruption(req: DisruptionCreateRequest, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    ev = DisruptionEvent(
        type=req.type,
        plan_id=req.plan_id,
        occurs_at_slot=req.occurs_at_slot,
        payload=req.payload,
        description=req.description or f"Disruption event ({req.type}) at slot {req.occurs_at_slot}",
        created_by=user.id,
        is_example=False,
    )
    db.add(ev)
    db.flush()
    audit(db, "disruption.create", "disruption_event", ev.id, f"Recorded disruption {ev.type} (#{ev.id})", user, commit=True)
    return {
        "id": ev.id, "type": ev.type, "plan_id": ev.plan_id, "occurs_at_slot": ev.occurs_at_slot,
        "payload": ev.payload, "description": ev.description,
    }


@router.post("/plans/{plan_id}/replan")
def replan_schedule(plan_id: int, req: ReplanRequest, user: User = Depends(require_coordinator), db: Session = Depends(get_db)):
    base_plan = db.get(Plan, plan_id)
    if not base_plan:
        raise HTTPException(404, "Base plan not found")

    if req.disruption_event_id:
        ev = db.get(DisruptionEvent, req.disruption_event_id)
        if not ev:
            raise HTTPException(404, "Disruption event not found")
    else:
        dtype = req.disruption_type or "early_rain"
        ev = DisruptionEvent(
            type=dtype,
            plan_id=base_plan.id,
            occurs_at_slot=req.occurs_at_slot,
            payload=req.payload,
            description=req.description or f"Disruption ({dtype}) triggered at slot {req.occurs_at_slot}",
            created_by=user.id,
            is_example=False,
        )
        db.add(ev)
        db.flush()

    now_slot = ev.occurs_at_slot
    mark_progress(base_plan, now_slot)
    overrides, new_ss = apply_disruption_overrides(db, base_plan, ev)
    frozen = frozen_from_plan(base_plan, now_slot, overrides.get("duration_overrides", {}))
    ps = db.get(TwinParameterSet, base_plan.parameter_set_id) or active_parameter_set(db, "base")

    ctx = build_from_db(db, new_ss, ps, now_slot=now_slot, overrides=overrides, frozen=frozen)
    asg, solver = run_policy(ctx, "optimized", time_limit=req.time_limit_s, seed=42)
    new_plan = persist_plan(
        db, ctx, asg, solver,
        name=f"{base_plan.name.split(' (Replan')[0]} (Replanned · {ev.type})",
        scenario_set=new_ss,
        param_set=ps,
        user=user,
        policy="optimized",
        parent=base_plan,
        overrides=overrides,
        disruption=ev,
    )
    new_plan.diff = diff_plans(base_plan, new_plan.assignments, ctx, ev, new_plan.unscheduled or [])
    ev.resulting_plan_id = new_plan.id

    notify(
        db, "schedule_updated",
        f"Dynamic Replanning Complete: Plan #{new_plan.id} (v{new_plan.version})",
        f"Disruption '{ev.type}' at slot {now_slot}: {len(frozen)} completed/in-progress task(s) frozen; remaining work re-optimized.",
        "warning", "all", "/replanning",
    )
    audit(
        db, "plan.replan", "plan", new_plan.id,
        f"Replanned Plan #{base_plan.id} -> Plan #{new_plan.id} (v{new_plan.version}) after {ev.type}; frozen={len(frozen)}",
        user, {"parent_plan_id": base_plan.id, "disruption_id": ev.id, "frozen_tasks": list(frozen)}, commit=True,
    )
    return {
        "previous_plan": _serialize_plan(base_plan, db, include_assignments=True),
        "new_plan": _serialize_plan(new_plan, db, include_assignments=True),
        "disruption": {
            "id": ev.id, "type": ev.type, "occurs_at_slot": ev.occurs_at_slot,
            "description": ev.description, "payload": ev.payload,
        },
        "diff": new_plan.diff,
    }


# ===========================================================================
# 10. AI EXPLANATION ASSISTANT
# ===========================================================================

@router.post("/assistant/chat")
def assistant_chat(req: AssistantChatRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ans = answer_question(db, req.message, req.plan_id)
    audit(db, "assistant.query", "assistant", ans.get("plan_id"), f"Assistant query: {req.message[:80]}", user, commit=True)
    return ans


# ===========================================================================
# 11. GOVERNANCE, ASSUMPTIONS, NOTIFICATIONS & AUDIT
# ===========================================================================

@router.get("/governance/overview")
def governance_overview(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ss = default_set(db)
    param_sets = list(db.execute(select(TwinParameterSet).order_by(TwinParameterSet.id)).scalars())
    sim_runs = list(db.execute(select(SimulationRun).order_by(SimulationRun.id.desc()).limit(15)).scalars())
    plans = list(db.execute(select(Plan).order_by(Plan.id.desc()).limit(15)).scalars())
    feedbacks = list(db.execute(select(ExpertFeedback).order_by(ExpertFeedback.id.desc()).limit(20)).scalars())
    rules = list(db.execute(select(TaskRule).order_by(TaskRule.id)).scalars())
    return {
        "weather": set_meta(ss) if ss else None,
        "parameter_sets": [
            {
                "id": p.id, "name": p.name, "version": p.version, "sensitivity": p.sensitivity,
                "params": p.params, "provenance": p.provenance, "validation_status": p.validation_status,
                "reviewer": p.reviewer, "review_notes": p.review_notes,
                "reviewed_at": as_utc(p.reviewed_at).isoformat() if p.reviewed_at else None,
            }
            for p in param_sets
        ],
        "parameter_docs": PARAM_DOCS,
        "task_rules": [
            {
                "id": r.id, "code": r.code, "name": r.name, "setup_minutes": r.setup_minutes,
                "minutes_per_acre": r.minutes_per_acre, "max_rain_mm_per_hour": r.max_rain_mm_per_hour,
                "dry_hours_after": r.dry_hours_after, "min_window_probability": r.min_window_probability,
                "approved_by": r.approved_by, "evidence_label": r.evidence_label,
            }
            for r in rules
        ],
        "simulation_runs": [
            {
                "id": s.id, "scenario_set_id": s.scenario_set_id, "parameter_set_id": s.parameter_set_id,
                "model_version": s.model_version, "input_hash": s.input_hash, "duration_ms": s.duration_ms,
                "created_at": as_utc(s.created_at).isoformat(),
            }
            for s in sim_runs
        ],
        "solver_runs": [
            {
                "plan_id": pl.id, "name": pl.name, "version": pl.version, "status": pl.status,
                "policy": pl.policy, "solver": pl.solver, "valid": (pl.validation or {}).get("valid"),
                "created_at": as_utc(pl.created_at).isoformat(),
            }
            for pl in plans
        ],
        "expert_feedback": [
            {
                "id": f.id, "entity_type": f.entity_type, "entity_id": f.entity_id,
                "decision": f.decision, "comment": f.comment, "created_at": as_utc(f.created_at).isoformat(),
            }
            for f in feedbacks
        ],
        "evidence_taxonomy": [
            {"label": "VERIFIED SOURCE FACT", "meaning": "Directly retrieved from an external authority (e.g., live Open-Meteo Ensemble API response metadata)."},
            {"label": "MODEL ASSUMPTION", "meaning": "Configurable mathematical equation or coefficient in the conceptual wetness/hazard/protection twin."},
            {"label": "SIMULATED RESULT", "meaning": "Output computed by the simulation engine or OR-Tools CP-SAT optimizer; not field-validated disease incidence."},
            {"label": "FIELD OBSERVATION", "meaning": "Grower or scout observation recorded on a farm plot (e.g., drainage class or waterlogging note)."},
            {"label": "EXPERT REVIEWED", "meaning": "Operational rule or parameter set reviewed by an agricultural specialist."},
        ],
    }


@router.put("/governance/parameters/{param_set_id}")
def update_parameter_set(param_set_id: int, req: ParameterUpdateRequest,
                         user: User = Depends(require_role("admin", "coordinator")), db: Session = Depends(get_db)):
    ps = db.get(TwinParameterSet, param_set_id)
    if not ps:
        raise HTTPException(404, "Parameter set not found")
    merged = dict(ps.params)
    for k, v in req.params.items():
        if k in BASE_PARAMS:
            merged[k] = float(v)
    ps.params = merged
    if req.review_notes:
        ps.review_notes = req.review_notes
    ps.reviewer = user.full_name
    ps.reviewed_at = utcnow()
    audit(db, "governance.update_params", "twin_parameter_set", ps.id, f"Updated parameters for {ps.version}", user, commit=True)
    return {"id": ps.id, "version": ps.version, "params": ps.params, "reviewer": ps.reviewer}


@router.post("/governance/feedback", status_code=status.HTTP_201_CREATED)
def submit_expert_feedback(req: ExpertFeedbackCreate, user: User = Depends(require_role("admin", "coordinator")), db: Session = Depends(get_db)):
    fb = ExpertFeedback(user_id=user.id, entity_type=req.entity_type, entity_id=req.entity_id, decision=req.decision, comment=req.comment)
    db.add(fb)
    db.flush()
    audit(db, "governance.feedback", req.entity_type, req.entity_id, f"Expert feedback ({req.decision}): {req.comment[:80]}", user, commit=True)
    return {"id": fb.id, "entity_type": fb.entity_type, "entity_id": fb.entity_id, "decision": fb.decision, "comment": fb.comment, "created_at": as_utc(fb.created_at).isoformat()}


@router.get("/runs/{run_id}/audit")
def get_run_audit(run_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = db.get(Plan, run_id)
    if plan:
        ss = db.get(WeatherScenarioSet, plan.scenario_set_id)
        ps = db.get(TwinParameterSet, plan.parameter_set_id)
        logs = list(db.execute(select(AuditLog).where(AuditLog.entity_type == "plan", AuditLog.entity_id == str(run_id)).order_by(AuditLog.id.desc())).scalars())
        return {
            "type": "plan",
            "plan": _serialize_plan(plan, db, include_assignments=True),
            "scenario_set": set_meta(ss) if ss else None,
            "parameter_set": {"id": ps.id, "version": ps.version, "sensitivity": ps.sensitivity, "params": ps.params} if ps else None,
            "audit_logs": [{"id": l.id, "action": l.action, "summary": l.summary, "user_email": l.user_email, "created_at": as_utc(l.created_at).isoformat()} for l in logs],
        }
    sim = db.get(SimulationRun, run_id)
    if sim:
        ss = db.get(WeatherScenarioSet, sim.scenario_set_id)
        ps = db.get(TwinParameterSet, sim.parameter_set_id)
        return _format_simulation(sim, ss, ps)
    raise HTTPException(404, "Run not found")


@router.get("/activity")
def list_activity(limit: int = Query(default=50, ge=1, le=200), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    logs = list(db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)).scalars())
    return [
        {
            "id": l.id, "created_at": as_utc(l.created_at).isoformat(), "user_id": l.user_id,
            "user_email": l.user_email, "action": l.action, "entity_type": l.entity_type,
            "entity_id": l.entity_id, "summary": l.summary, "details": l.details,
        }
        for l in logs
    ]


@router.get("/notifications")
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.execute(select(Notification).order_by(Notification.id.desc()).limit(40)).scalars())
    out = []
    for n in rows:
        if n.user_id is not None and n.user_id != user.id:
            continue
        if n.audience not in ("all", user.role) and user.role != "admin":
            continue
        out.append({
            "id": n.id, "type": n.type, "title": n.title, "message": n.message,
            "severity": n.severity, "audience": n.audience, "link": n.link,
            "is_read": user.id in (n.read_by or []),
            "created_at": as_utc(n.created_at).isoformat(),
        })
    return out


@router.post("/notifications/{notif_id}/read")
def mark_notification_read(notif_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(Notification, notif_id)
    if not n:
        raise HTTPException(404, "Notification not found")
    rb = list(n.read_by or [])
    if user.id not in rb:
        rb.append(user.id)
        n.read_by = rb
        db.commit()
    return {"id": n.id, "is_read": True}


# ===========================================================================
# 12. ONE-CLICK END-TO-END DEMO WORKFLOW
# ===========================================================================

@router.post("/demo/walkthrough")
def run_one_click_demo_workflow(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Executes the complete end-to-end acceptance workflow and returns a step-by-step trace."""
    t0 = time.perf_counter()
    ss = default_set(db)
    ps = active_parameter_set(db, "base")
    plots = list(db.execute(select(Plot).order_by(Plot.code)).scalars())
    rain = rain_matrix(ss)
    pinputs = plot_inputs(plots)
    summaries = [summarize_plot(p, rain, ps.params) for p in pinputs]
    queue = build_priority_queue(summaries, {p.plot_id: p for p in pinputs})
    sim = SimulationRun(
        scenario_set_id=ss.id, parameter_set_id=ps.id, model_version=ps.version, seed=42,
        created_by=user.id, input_hash=input_hash({"demo": True, "ss": ss.id}),
        results={"summaries": summaries, "priority_queue": queue}, duration_ms=25.0,
    )
    db.add(sim)
    db.flush()

    ctx = build_from_db(db, ss, ps, now_slot=0)
    asg, solver = run_policy(ctx, "optimized", time_limit=6.0, seed=42)
    base_plan = persist_plan(
        db, ctx, asg, solver,
        name="Walkthrough Baseline Schedule v1",
        scenario_set=ss, param_set=ps, user=user, policy="optimized", simulation_run_id=sim.id,
    )
    base_plan.status = "approved"
    base_plan.approved_by = user.id
    base_plan.approved_at = utcnow()

    pol_res = run_policies(ctx, time_limit_s=6.0, seed=42)
    pr = PolicyResult(
        scenario_set_id=ss.id, parameter_set_id=ps.id,
        config={"sensitivity": "base", "evaluation_mode": "in_sample", "seed": 42},
        results=pol_res, created_by=user.id, duration_ms=120.0,
    )
    db.add(pr)
    db.flush()

    # Trigger early rain disruption at slot 16
    ev = DisruptionEvent(
        type="early_rain", plan_id=base_plan.id, occurs_at_slot=16,
        payload={"start_hour": 5, "end_hour": 10, "intensity_mm": 4.2, "probability": 0.9, "seed": 7},
        description="One-click walkthrough: Early monsoon squall arrives in hours +5h..+10h; completed work frozen.",
        created_by=user.id, is_example=False,
    )
    db.add(ev)
    db.flush()

    mark_progress(base_plan, 16)
    overrides, new_ss = apply_disruption_overrides(db, base_plan, ev)
    frozen = frozen_from_plan(base_plan, 16, {})
    ctx2 = build_from_db(db, new_ss, ps, now_slot=16, overrides=overrides, frozen=frozen)
    asg2, solver2 = run_policy(ctx2, "optimized", time_limit=6.0, seed=42)
    replanned = persist_plan(
        db, ctx2, asg2, solver2,
        name="Walkthrough Replanned Schedule v2 (Early Rain)",
        scenario_set=new_ss, param_set=ps, user=user, policy="optimized",
        parent=base_plan, overrides=overrides, disruption=ev, simulation_run_id=sim.id,
    )
    replanned.diff = diff_plans(base_plan, replanned.assignments, ctx2, ev, replanned.unscheduled or [])
    ev.resulting_plan_id = replanned.id
    audit(db, "demo.walkthrough", "plan", replanned.id, "Executed one-click end-to-end demo workflow", user, commit=True)

    return {
        "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
        "simulation_run_id": sim.id,
        "base_plan_id": base_plan.id,
        "replanned_plan_id": replanned.id,
        "policy_result_id": pr.id,
        "top_priority_plot": queue[0] if queue else None,
        "frozen_count": len(frozen),
        "changed_count": sum(1 for d in (replanned.diff or []) if d["change"] not in ("unchanged",)),
    }
