"""Deterministic first-run seed data for the Thirthahalli Arecanut Cooperative cluster
(Shivamogga district, Karnataka). All demo farms, plots, crews, equipment, and synthetic
scenarios are explicitly flagged with ``is_synthetic = True`` and provenance labels.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import (
    Crew,
    DisruptionEvent,
    Equipment,
    ExpertFeedback,
    Farm,
    Notification,
    Plan,
    Plot,
    SimulationRun,
    TaskRule,
    TwinParameterSet,
    User,
    WeatherScenarioSet,
)
from app.services.audit import audit, notify
from app.services.planning import active_parameter_set, build_from_db, persist_plan, plot_inputs, run_policy
from app.simulation.twin import (
    BASE_PARAMS,
    MODEL_VERSION,
    PARAM_DOCS,
    build_priority_queue,
    input_hash,
    params_for,
    summarize_plot,
)
from app.weather.service import create_synthetic_set, floor_hour, rain_matrix


def seed_all(db: Session) -> dict:
    existing_user = db.execute(select(User).limit(1)).scalar_one_or_none()
    if existing_user is not None:
        return {"seeded": False, "reason": "already_seeded"}

    # 1. Users (documented demo credentials)
    coordinator = User(
        email="coordinator@mahalishield.org",
        full_name="Kaveri Hegde (Cooperative Coordinator)",
        hashed_password=hash_password("Mahali@2026"),
        role="coordinator",
        language="en",
        phone="+91-94480-11201",
        preferences={"units": "metric", "timezone": "Asia/Kolkata", "notifications_enabled": True},
    )
    farmer = User(
        email="farmer@mahalishield.org",
        full_name="Ramesh Gowda (Arecanut Grower)",
        hashed_password=hash_password("Mahali@2026"),
        role="farmer",
        language="en",
        phone="+91-94480-22314",
        preferences={"units": "metric", "timezone": "Asia/Kolkata", "notifications_enabled": True},
    )
    admin = User(
        email="expert@mahalishield.org",
        full_name="Dr. Vishwanath Bhat (Plant Pathology & Systems Reviewer)",
        hashed_password=hash_password("Mahali@2026"),
        role="admin",
        language="en",
        phone="+91-94480-33429",
        preferences={"units": "metric", "timezone": "Asia/Kolkata", "notifications_enabled": True},
    )
    db.add_all([coordinator, farmer, admin])
    db.flush()

    # 2. Farms & Plots (Thirthahalli cluster, Malnad region — SYNTHETIC DEMO)
    farms_data = [
        ("Tunga Valley Arecanut Estate", "Agumbe Road, Thirthahalli", farmer.id, "Ramesh Gowda", 13.6945, 75.2340),
        ("Malnad Sahyadri Thota", "Melige, Thirthahalli", farmer.id, "Ramesh Gowda", 13.6812, 75.2518),
        ("Sharavathi Cooperative Cluster", "Konandur, Thirthahalli", None, "Suresh Hebbar", 13.7028, 75.2610),
        ("Kuppalli Heritage Plantation", "Kuppalli, Thirthahalli", None, "Anitha Rao", 13.6710, 75.2295),
    ]
    farms: list[Farm] = []
    for name, village, owner_id, grower, lat, lon in farms_data:
        f = Farm(name=name, village=village, owner_id=owner_id, grower_name=grower, lat=lat, lon=lon, is_synthetic=True)
        db.add(f)
        farms.append(f)
    db.flush()

    plots_spec = [
        ("P-001", farms[0].id, "Tunga Lower Block A", 13.6952, 75.2332, 2.5, "high", "poor", 0.78, 0.18, True, "Valley floor block with slow drainage."),
        ("P-002", farms[0].id, "Tunga Terrace Block B", 13.6938, 75.2361, 1.8, "medium", "moderate", 0.62, 0.42, False, "Mid-slope terraced palms."),
        ("P-003", farms[1].id, "Sahyadri Creek Edge", 13.6805, 75.2504, 3.0, "high", "poor", 0.81, 0.12, True, "Dense intercropped block near stream."),
        ("P-004", farms[1].id, "Sahyadri Upper Ridge", 13.6829, 75.2535, 1.5, "low", "good", 0.52, 0.65, False, "Well-drained ridge plot."),
        ("P-005", farms[2].id, "Konandur East Block", 13.7035, 75.2622, 2.2, "medium", "moderate", 0.68, 0.28, False, "Mature 18-year stand."),
        ("P-006", farms[2].id, "Konandur Hollow", 13.7011, 75.2590, 2.8, "high", "poor", 0.76, 0.15, False, "Humid hollow with high canopy closure."),
        ("P-007", farms[3].id, "Kuppalli North Slope", 13.6724, 75.2281, 2.0, "medium", "good", 0.58, 0.50, False, "Recently pruned drainage channels."),
        ("P-014", farms[0].id, "Tunga Old-Growth Basin", 13.6968, 75.2315, 3.2, "urgent", "poor", 0.85, 0.08, True, "Flagship high-exposure basin plot requiring pre-inspection + protection."),
    ]
    plots: list[Plot] = []
    for code, fid, name, lat, lon, area, prio, drain, canopy, prot, insp, notes in plots_spec:
        pl = Plot(
            code=code, farm_id=fid, name=name, lat=lat, lon=lon, area_acres=area, priority=prio,
            status="pending", drainage=drain, canopy_density=canopy, protection_state=prot,
            inspection_required=insp, notes=notes, is_synthetic=True,
        )
        db.add(pl)
        plots.append(pl)
    db.flush()

    # 3. Crews & Equipment
    crews_spec = [
        ("C-01", "Sahyadri Rapid Crew Alpha", "Manjunath Poojary", 4, 7, 18, 8.0, ["INSP", "PROT"], 13.6900, 75.2400),
        ("C-02", "Tunga Climbing & Protection Beta", "Prakash Shetty", 4, 7, 18, 8.0, ["INSP", "PROT"], 13.6950, 75.2350),
        ("C-03", "Konandur Field Unit Gamma", "Harish Naik", 3, 7, 17, 7.5, ["PROT"], 13.7020, 75.2600),
        ("C-04", "Malnad Scout & Inspection Delta", "Deepak Kini", 2, 7, 17, 7.0, ["INSP"], 13.6820, 75.2500),
    ]
    for code, name, leader, size, s0, s1, maxh, elig, lat, lon in crews_spec:
        db.add(Crew(
            code=code, name=name, leader=leader, size=size, is_available=True,
            shift_start_hour=s0, shift_end_hour=s1, max_hours_per_day=maxh,
            eligibility=elig, base_lat=lat, base_lon=lon, unavailable_periods=[], is_synthetic=True,
        ))

    eq_spec = [
        ("EQ-01", "sprayer_unit", "High-Head Rocker Sprayer Rig #1", 1, "operational", True, "Assigned to central depot"),
        ("EQ-02", "sprayer_unit", "High-Head Rocker Sprayer Rig #2", 1, "operational", True, "Assigned to northern depot"),
        ("EQ-03", "sprayer_unit", "Motorized Mist-Pump Assembly #3", 1, "operational", True, "Backup unit at Melige"),
        ("EQ-04", "inspection_kit", "Canopy Moisture & Crown Inspection Kit", 2, "operational", True, "Supports 2 simultaneous field inspections"),
    ]
    for code, etype, name, cap, st, avail, notes in eq_spec:
        db.add(Equipment(code=code, type=etype, name=name, capacity=cap, status=st, is_available=avail, notes=notes, is_synthetic=True))

    # 4. Task Rules
    db.add_all([
        TaskRule(
            code="INSP",
            name="Pre-Operation Canopy & Drainage Inspection",
            description="Field verification of crown drainage and operational readiness before protection work on flagged plots.",
            setup_minutes=15,
            minutes_per_acre=15,
            required_equipment_type="inspection_kit",
            requires_dry_window=False,
            max_rain_mm_per_hour=2.5,
            dry_hours_after=0,
            min_window_probability=0.45,
            predecessor_code=None,
            applies_to="inspection_required",
            affects_protection=False,
            is_active=True,
            approved_by="Dr. Vishwanath Bhat",
            evidence_label="EXPERT REVIEWED",
        ),
        TaskRule(
            code="PROT",
            name="Approved Bunch Protection Operation",
            description="Expert-approved protective operation requiring a dry application window and post-operation drying period.",
            setup_minutes=20,
            minutes_per_acre=35,
            required_equipment_type="sprayer_unit",
            requires_dry_window=True,
            max_rain_mm_per_hour=0.3,
            dry_hours_after=3,
            min_window_probability=0.60,
            predecessor_code="INSP",
            applies_to="all",
            affects_protection=True,
            is_active=True,
            approved_by="Dr. Vishwanath Bhat",
            evidence_label="EXPERT REVIEWED",
        ),
    ])

    # 5. Twin Parameter Sets (low / base / high sensitivity)
    provenance = {
        k: {
            "evidence_label": "MODEL ASSUMPTION",
            "unit": v["unit"],
            "meaning": v["meaning"],
            "source": "MahaliShield conceptual wetness-hazard-protection formulation (twin-0.3.0); not a calibrated koleroga model.",
        }
        for k, v in PARAM_DOCS.items()
    }
    for sens in ("low", "base", "high"):
        db.add(TwinParameterSet(
            name=f"Malnad Monsoon Conceptual Twin ({sens.upper()})",
            version=f"{MODEL_VERSION}-{sens}",
            sensitivity=sens,
            params=params_for(sens, BASE_PARAMS),
            provenance=provenance,
            is_active=True,
            validation_status="conceptual_expert_reviewed" if sens == "base" else "sensitivity_variant",
            reviewer="Dr. Vishwanath Bhat",
            review_notes="Conceptual decision-support formulation approved for relative scheduling comparison only; never interpret E(t) as disease probability.",
            reviewed_at=datetime.now(timezone.utc),
        ))
    db.flush()

    # 6. Seed synthetic scenario sets (aligned to 06:00 IST morning shift start)
    hs = datetime(2026, 7, 15, 0, 30, tzinfo=timezone.utc)
    ss_main = create_synthetic_set(
        db, seed=42, members=30, hours=72, horizon_start=hs, source_type="synthetic",
        label="SYNTHETIC Demo Ensemble · Malnad Monsoon Break Cluster (seed 42 · 30 members)",
    )
    create_synthetic_set(
        db, seed=108, members=30, hours=72, horizon_start=hs, source_type="replay", wetness=1.25,
        label="SYNTHETIC Historical-Style Heavy Spell Replay (seed 108 · 30 members)",
    )

    # 7. Initial Simulation Run + Initial Optimized Plan
    ps_base = active_parameter_set(db, "base")
    rain = rain_matrix(ss_main)
    pinputs = plot_inputs(plots)
    pin_map = {p.plot_id: p for p in pinputs}
    summaries = [summarize_plot(p, rain, ps_base.params) for p in pinputs]
    queue = build_priority_queue(summaries, pin_map)
    sim = SimulationRun(
        scenario_set_id=ss_main.id,
        parameter_set_id=ps_base.id,
        model_version=ps_base.version,
        seed=42,
        created_by=coordinator.id,
        input_hash=input_hash({"ss": ss_main.id, "ps": ps_base.id, "plots": [p.code for p in plots]}),
        results={"summaries": summaries, "priority_queue": queue},
        duration_ms=42.0,
    )
    db.add(sim)
    db.flush()

    ctx = build_from_db(db, ss_main, ps_base, now_slot=0)
    asg, solver = run_policy(ctx, "optimized", time_limit=6.0, seed=42)
    plan = persist_plan(
        db, ctx, asg, solver,
        name="Initial Monsoon Gap Schedule v1",
        scenario_set=ss_main,
        param_set=ps_base,
        user=coordinator,
        policy="optimized",
        simulation_run_id=sim.id,
    )
    plan.status = "approved"
    plan.approved_by = coordinator.id
    plan.approved_at = datetime.now(timezone.utc)

    # Example preset disruption templates
    c2 = db.execute(select(Crew).where(Crew.code == "C-02")).scalar_one()
    eq1 = db.execute(select(Equipment).where(Equipment.code == "EQ-01")).scalar_one()
    p006 = db.execute(select(Plot).where(Plot.code == "P-006")).scalar_one()
    db.add_all([
        DisruptionEvent(
            type="early_rain", plan_id=plan.id, occurs_at_slot=16,
            payload={"start_hour": 5, "end_hour": 10, "intensity_mm": 4.2, "probability": 0.9, "seed": 7},
            description="Monsoon squall arrives 3 hours earlier than median forecast during Window 1 (hours +5h to +10h).",
            created_by=coordinator.id, is_example=True,
        ),
        DisruptionEvent(
            type="crew_unavailable", plan_id=plan.id, occurs_at_slot=16,
            payload={"crew_id": c2.id, "start_slot": 16, "end_slot": 96, "reason": "Crew C-02 vehicle breakdown on Agumbe Ghat"},
            description="Crew C-02 becomes unavailable from slot 16 to 96 due to transport breakdown.",
            created_by=coordinator.id, is_example=True,
        ),
        DisruptionEvent(
            type="equipment_failure", plan_id=plan.id, occurs_at_slot=16,
            payload={"equipment_id": eq1.id, "from_slot": 16},
            description="High-Head Rocker Sprayer Rig #1 (EQ-01) pressure valve failure at slot 16.",
            created_by=coordinator.id, is_example=True,
        ),
        DisruptionEvent(
            type="urgent_priority", plan_id=plan.id, occurs_at_slot=16,
            payload={"plot_id": p006.id},
            description="Field scout reports waterlogging in Plot P-006 (Konandur Hollow); escalated to URGENT.",
            created_by=coordinator.id, is_example=True,
        ),
    ])

    db.add(ExpertFeedback(
        user_id=admin.id,
        entity_type="twin_parameter_set",
        entity_id=str(ps_base.id),
        decision="approved",
        comment="Reviewed base wetness decay and post-operation 3-hour drying window rules for Thirthahalli cooperative cluster. Keep explicit SIMULATED RESULT labelling.",
    ))

    notify(
        db, "plan_approved", "Initial Schedule v1 Approved",
        f"Plan #{plan.id} (Initial Monsoon Gap Schedule v1) has been optimized via OR-Tools CP-SAT and approved for the 72h horizon.",
        "success", "all", "/gantt",
    )
    notify(
        db, "synthetic_notice", "Synthetic Demo Weather Active",
        "Application seeded with 30-member SYNTHETIC monsoon ensemble (seed 42). Click 'Fetch Live Open-Meteo Ensemble' on Rain-Gap Twin to pull live forecasts.",
        "info", "coordinator", "/rain-gap",
    )
    audit(
        db, "system.seeded", "system", "init",
        "Seeded Thirthahalli Arecanut Cooperative demo cluster, 8 plots, 4 crews, 30-member synthetic ensemble, simulation run #1, and CP-SAT Plan #1.",
        coordinator,
    )
    db.commit()
    return {"seeded": True, "plan_id": plan.id, "scenario_set_id": ss_main.id, "simulation_run_id": sim.id}
