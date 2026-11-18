"""SQLAlchemy ORM models for MahaliShield."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="farmer", nullable=False)  # farmer|coordinator|admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    language: Mapped[str] = mapped_column(String(5), default="en", nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    reset_token: Mapped[str | None] = mapped_column(String(128))
    reset_token_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    farms: Mapped[list[Farm]] = relationship(back_populates="owner")


class Farm(TimestampMixin, Base):
    __tablename__ = "farms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    village: Mapped[str | None] = mapped_column(String(200))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    grower_name: Mapped[str | None] = mapped_column(String(200))
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner: Mapped[User | None] = relationship(back_populates="farms")
    plots: Mapped[list[Plot]] = relationship(back_populates="farm", cascade="all, delete-orphan")


class Plot(TimestampMixin, Base):
    __tablename__ = "plots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)  # e.g. P-014
    farm_id: Mapped[int] = mapped_column(ForeignKey("farms.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    area_acres: Mapped[float] = mapped_column(Float, nullable=False)
    priority: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)  # low|medium|high|urgent
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)  # pending|scheduled|protected|inactive
    drainage: Mapped[str] = mapped_column(String(10), default="moderate", nullable=False)  # poor|moderate|good
    canopy_density: Mapped[float] = mapped_column(Float, default=0.6, nullable=False)  # 0..1
    protection_state: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)  # 0..1 (assumed)
    last_protection_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    inspection_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    assigned_crew_id: Mapped[int | None] = mapped_column(ForeignKey("crews.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    farm: Mapped[Farm] = relationship(back_populates="plots")
    assigned_crew: Mapped[Crew | None] = relationship(foreign_keys=[assigned_crew_id])

    __table_args__ = (Index("ix_plots_status_priority", "status", "priority"),)


class Crew(TimestampMixin, Base):
    __tablename__ = "crews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)  # e.g. C-02
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    leader: Mapped[str | None] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    shift_start_hour: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    shift_end_hour: Mapped[int] = mapped_column(Integer, default=18, nullable=False)
    max_hours_per_day: Mapped[float] = mapped_column(Float, default=8.0, nullable=False)
    eligibility: Mapped[list[str]] = mapped_column(JSON, default=list)  # list of TaskRule codes
    base_lat: Mapped[float] = mapped_column(Float, nullable=False)
    base_lon: Mapped[float] = mapped_column(Float, nullable=False)
    unavailable_periods: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list)  # [{start,end,reason}] ISO
    current_assignment: Mapped[str | None] = mapped_column(String(200))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Equipment(TimestampMixin, Base):
    __tablename__ = "equipment"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)  # e.g. sprayer_unit
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # simultaneous tasks supported
    status: Mapped[str] = mapped_column(String(20), default="operational", nullable=False)  # operational|maintenance|failed
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class TaskRule(TimestampMixin, Base):
    __tablename__ = "task_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)  # PROT|INSP
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    setup_minutes: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    minutes_per_acre: Mapped[int] = mapped_column(Integer, default=40, nullable=False)
    required_equipment_type: Mapped[str | None] = mapped_column(String(50))
    requires_dry_window: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_rain_mm_per_hour: Mapped[float] = mapped_column(Float, default=0.3, nullable=False)
    dry_hours_after: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    min_window_probability: Mapped[float] = mapped_column(Float, default=0.6, nullable=False)
    predecessor_code: Mapped[str | None] = mapped_column(String(20))
    applies_to: Mapped[str] = mapped_column(String(30), default="all", nullable=False)  # all|inspection_required
    affects_protection: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(200))
    evidence_label: Mapped[str] = mapped_column(String(40), default="MODEL ASSUMPTION", nullable=False)


class WeatherScenarioSet(TimestampMixin, Base):
    __tablename__ = "weather_scenario_sets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)  # live|synthetic|replay|derived
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    run_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    horizon_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    hours: Mapped[int] = mapped_column(Integer, nullable=False)
    request_lat: Mapped[float] = mapped_column(Float, nullable=False)
    request_lon: Mapped[float] = mapped_column(Float, nullable=False)
    grid_lat: Mapped[float | None] = mapped_column(Float)
    grid_lon: Mapped[float | None] = mapped_column(Float)
    member_count: Mapped[int] = mapped_column(Integer, nullable=False)
    seed: Mapped[int | None] = mapped_column(Integer)
    parent_set_id: Mapped[int | None] = mapped_column(ForeignKey("weather_scenario_sets.id", ondelete="SET NULL"))
    modification: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    quality: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    label: Mapped[str] = mapped_column(String(300), nullable=False)

    scenarios: Mapped[list[WeatherScenario]] = relationship(back_populates="scenario_set", cascade="all, delete-orphan",
                                                            order_by="WeatherScenario.member_id")


class WeatherScenario(Base):
    __tablename__ = "weather_scenarios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    set_id: Mapped[int] = mapped_column(ForeignKey("weather_scenario_sets.id", ondelete="CASCADE"), index=True, nullable=False)
    member_id: Mapped[int] = mapped_column(Integer, nullable=False)
    rainfall_mm: Mapped[list[float]] = mapped_column(JSON, nullable=False)  # hourly, aligned to set.horizon_start
    valid_times: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    missing_hours: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    scenario_set: Mapped[WeatherScenarioSet] = relationship(back_populates="scenarios")
    __table_args__ = (UniqueConstraint("set_id", "member_id", name="uq_scenario_member"),)


class TwinParameterSet(TimestampMixin, Base):
    __tablename__ = "twin_parameter_sets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[str] = mapped_column(String(30), nullable=False)
    sensitivity: Mapped[str] = mapped_column(String(10), nullable=False)  # low|base|high
    params: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # per-param: {label, source, note}
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    validation_status: Mapped[str] = mapped_column(String(30), default="unvalidated", nullable=False)
    reviewer: Mapped[str | None] = mapped_column(String(200))
    review_notes: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (UniqueConstraint("name", "version", name="uq_param_version"),)


class SimulationRun(TimestampMixin, Base):
    __tablename__ = "simulation_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scenario_set_id: Mapped[int] = mapped_column(ForeignKey("weather_scenario_sets.id"), index=True, nullable=False)
    parameter_set_id: Mapped[int] = mapped_column(ForeignKey("twin_parameter_sets.id"), nullable=False)
    model_version: Mapped[str] = mapped_column(String(30), nullable=False)
    seed: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    results: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    duration_ms: Mapped[float] = mapped_column(Float, default=0.0)


class Plan(TimestampMixin, Base):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    lineage_id: Mapped[int | None] = mapped_column(Integer, index=True)  # id of root plan
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    parent_plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)  # draft|approved|superseded|rejected
    policy: Mapped[str] = mapped_column(String(30), default="optimized", nullable=False)
    scenario_set_id: Mapped[int] = mapped_column(ForeignKey("weather_scenario_sets.id"), nullable=False)
    parameter_set_id: Mapped[int] = mapped_column(ForeignKey("twin_parameter_sets.id"), nullable=False)
    simulation_run_id: Mapped[int | None] = mapped_column(ForeignKey("simulation_runs.id", ondelete="SET NULL"))
    horizon_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    horizon_hours: Mapped[int] = mapped_column(Integer, nullable=False)
    now_slot: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # overrides & config used
    solver: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # status, objective, bound, time
    validation: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    unscheduled: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    diff: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    disruption_event_id: Mapped[int | None] = mapped_column(ForeignKey("disruption_events.id", ondelete="SET NULL"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    assignments: Mapped[list[Assignment]] = relationship(back_populates="plan", cascade="all, delete-orphan",
                                                         order_by="Assignment.start_slot")


class Assignment(TimestampMixin, Base):
    __tablename__ = "assignments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True, nullable=False)
    task_key: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. PROT:P-014
    task_code: Mapped[str] = mapped_column(String(20), nullable=False)
    plot_id: Mapped[int] = mapped_column(ForeignKey("plots.id", ondelete="CASCADE"), index=True, nullable=False)
    crew_id: Mapped[int] = mapped_column(ForeignKey("crews.id", ondelete="CASCADE"), index=True, nullable=False)
    equipment_type: Mapped[str | None] = mapped_column(String(50))
    start_slot: Mapped[int] = mapped_column(Integer, nullable=False)
    end_slot: Mapped[int] = mapped_column(Integer, nullable=False)
    travel_slots: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)  # planned|in_progress|completed
    frozen: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    window_probability: Mapped[float | None] = mapped_column(Float)
    expected_exposure: Mapped[float | None] = mapped_column(Float)
    exposure_if_unprotected: Mapped[float | None] = mapped_column(Float)
    explanation: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    plan: Mapped[Plan] = relationship(back_populates="assignments")
    __table_args__ = (UniqueConstraint("plan_id", "task_key", name="uq_plan_task"),)


class DisruptionEvent(TimestampMixin, Base):
    __tablename__ = "disruption_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id", ondelete="SET NULL"), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    occurs_at_slot: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resulting_plan_id: Mapped[int | None] = mapped_column(Integer)
    is_example: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class PolicyResult(TimestampMixin, Base):
    __tablename__ = "policy_results"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scenario_set_id: Mapped[int] = mapped_column(ForeignKey("weather_scenario_sets.id"), nullable=False)
    parameter_set_id: Mapped[int] = mapped_column(ForeignKey("twin_parameter_sets.id"), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    results: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    duration_ms: Mapped[float] = mapped_column(Float, default=0.0)


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)  # null = broadcast
    audience: Mapped[str] = mapped_column(String(20), default="all", nullable=False)  # all|farmer|coordinator|admin
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(10), default="info", nullable=False)  # info|warning|critical|success
    link: Mapped[str | None] = mapped_column(String(200))
    read_by: Mapped[list[int]] = mapped_column(JSON, default=list)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    user_email: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(40))
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id"),)


class ExpertFeedback(TimestampMixin, Base):
    __tablename__ = "expert_feedback"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(40), nullable=False)
    decision: Mapped[str] = mapped_column(String(20), nullable=False)  # approved|changes_requested|comment
    comment: Mapped[str] = mapped_column(Text, nullable=False)
