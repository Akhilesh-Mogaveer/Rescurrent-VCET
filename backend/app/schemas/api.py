"""Pydantic v2 request and response schemas for MahaliShield REST API v1."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=200)
    password: str = Field(..., min_length=6, max_length=72)
    role: str = Field(default="farmer", pattern="^(farmer|coordinator|admin)$")
    language: str = Field(default="en", pattern="^(en|kn)$")
    phone: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    reset_token: str
    new_password: str = Field(..., min_length=6, max_length=72)


class UserUpdateRequest(BaseModel):
    full_name: str | None = None
    language: str | None = Field(default=None, pattern="^(en|kn)$")
    phone: str | None = None
    preferences: dict[str, Any] | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    language: str
    phone: str | None
    preferences: dict[str, Any]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class FarmCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    village: str | None = None
    grower_name: str | None = None
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    is_synthetic: bool = False


class PlotCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=20)
    farm_id: int | None = None
    farm_name: str | None = None
    name: str = Field(..., min_length=2, max_length=200)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    area_acres: float = Field(..., gt=0, le=200)
    priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")
    status: str = Field(default="pending", pattern="^(pending|scheduled|protected|inactive)$")
    drainage: str = Field(default="moderate", pattern="^(poor|moderate|good)$")
    canopy_density: float = Field(default=0.6, ge=0.0, le=1.0)
    protection_state: float = Field(default=0.1, ge=0.0, le=1.0)
    inspection_required: bool = False
    assigned_crew_id: int | None = None
    notes: str | None = None


class PlotUpdate(BaseModel):
    name: str | None = None
    farm_id: int | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    area_acres: float | None = Field(default=None, gt=0, le=200)
    priority: str | None = Field(default=None, pattern="^(low|medium|high|urgent)$")
    status: str | None = Field(default=None, pattern="^(pending|scheduled|protected|inactive)$")
    drainage: str | None = Field(default=None, pattern="^(poor|moderate|good)$")
    canopy_density: float | None = Field(default=None, ge=0.0, le=1.0)
    protection_state: float | None = Field(default=None, ge=0.0, le=1.0)
    inspection_required: bool | None = None
    assigned_crew_id: int | None = None
    notes: str | None = None


class CrewCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=20)
    name: str = Field(..., min_length=2, max_length=200)
    leader: str | None = None
    size: int = Field(default=3, ge=1, le=30)
    is_available: bool = True
    shift_start_hour: int = Field(default=7, ge=0, le=23)
    shift_end_hour: int = Field(default=18, ge=1, le=24)
    max_hours_per_day: float = Field(default=8.0, gt=0.5, le=16.0)
    eligibility: list[str] = Field(default_factory=lambda: ["INSP", "PROT"])
    base_lat: float = Field(default=13.69, ge=-90, le=90)
    base_lon: float = Field(default=75.24, ge=-180, le=180)
    unavailable_periods: list[dict[str, str]] = Field(default_factory=list)


class CrewUpdate(BaseModel):
    name: str | None = None
    leader: str | None = None
    size: int | None = Field(default=None, ge=1, le=30)
    is_available: bool | None = None
    shift_start_hour: int | None = Field(default=None, ge=0, le=23)
    shift_end_hour: int | None = Field(default=None, ge=1, le=24)
    max_hours_per_day: float | None = Field(default=None, gt=0.5, le=16.0)
    eligibility: list[str] | None = None
    base_lat: float | None = None
    base_lon: float | None = None
    unavailable_periods: list[dict[str, str]] | None = None
    current_assignment: str | None = None


class EquipmentCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=20)
    type: str = Field(default="sprayer_unit", min_length=2, max_length=50)
    name: str = Field(..., min_length=2, max_length=200)
    capacity: int = Field(default=1, ge=1, le=20)
    status: str = Field(default="operational", pattern="^(operational|maintenance|failed)$")
    is_available: bool = True
    notes: str | None = None


class EquipmentUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    capacity: int | None = Field(default=None, ge=1, le=20)
    status: str | None = Field(default=None, pattern="^(operational|maintenance|failed)$")
    is_available: bool | None = None
    notes: str | None = None


class TaskRuleUpdate(BaseModel):
    setup_minutes: int | None = Field(default=None, ge=0, le=240)
    minutes_per_acre: int | None = Field(default=None, ge=5, le=240)
    max_rain_mm_per_hour: float | None = Field(default=None, ge=0.0, le=20.0)
    dry_hours_after: int | None = Field(default=None, ge=0, le=24)
    min_window_probability: float | None = Field(default=None, ge=0.1, le=0.99)
    is_active: bool | None = None


class SimulationRequest(BaseModel):
    scenario_set_id: int | None = None
    sensitivity: str = Field(default="base", pattern="^(low|base|high)$")
    custom_params: dict[str, float] | None = None
    seed: int = 42


class OptimizeRequest(BaseModel):
    name: str | None = None
    scenario_set_id: int | None = None
    sensitivity: str = Field(default="base", pattern="^(low|base|high)$")
    policy: str = Field(default="optimized", pattern="^(optimized|reactive|calendar)$")
    time_limit_s: float = Field(default=8.0, ge=0.5, le=30.0)
    seed: int = 42
    now_slot: int = Field(default=0, ge=0, le=280)


class PolicyCompareRequest(BaseModel):
    scenario_set_id: int | None = None
    sensitivity: str = Field(default="base", pattern="^(low|base|high)$")
    evaluation_mode: str = Field(default="in_sample", pattern="^(in_sample|holdout)$")
    time_limit_s: float = Field(default=8.0, ge=0.5, le=30.0)
    seed: int = 42


class DisruptionCreateRequest(BaseModel):
    type: str = Field(
        ...,
        pattern="^(early_rain|crew_unavailable|equipment_failure|urgent_priority|task_overrun|weather_unavailable)$",
    )
    plan_id: int | None = None
    occurs_at_slot: int = Field(default=16, ge=0, le=280)
    payload: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None


class ReplanRequest(BaseModel):
    disruption_event_id: int | None = None
    disruption_type: str | None = None
    occurs_at_slot: int = Field(default=16, ge=0, le=280)
    payload: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None
    time_limit_s: float = Field(default=8.0, ge=0.5, le=30.0)


class AssistantChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    plan_id: int | None = None


class ExpertFeedbackCreate(BaseModel):
    entity_type: str = Field(default="twin_parameter_set")
    entity_id: str
    decision: str = Field(default="approved", pattern="^(approved|changes_requested|comment)$")
    comment: str = Field(..., min_length=3, max_length=2000)


class ParameterUpdateRequest(BaseModel):
    params: dict[str, float]
    review_notes: str | None = None
