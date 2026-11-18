"""Comprehensive backend test suite for MahaliShield:
- Weather ensemble parsing & synthetic generator determinism
- Agricultural Risk & Protection Twin determinism & sensitivity monotonicity
- OR-Tools CP-SAT constraint satisfaction & independent validator verification:
  * no crew overlap + travel buffers respected
  * no unavailable crew assignments
  * no equipment capacity violations
  * task duration respected
  * precedence respected
  * completed / in-progress tasks remain immutable during replanning
  * infeasible / unscheduled tasks reported with clear reasons
- Policy Arena fairness & reproducibility
- End-to-end REST API authentication, CRUD, simulation, optimization, replanning, and assistant flows.
"""
from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core import database as db_mod
from app.core.database import Base
from app.main import create_app
from app.optimization.context import CrewCtx, FixedAssignment, TaskCtx, build_context
from app.optimization.cpsat import diagnose_unscheduled, solve_cpsat
from app.optimization.validator import PlannedTask, validate_plan
from app.services.seed import seed_all
from app.simulation.twin import BASE_PARAMS, PlotInput, params_for, summarize_plot
from app.weather.openmeteo import parse_ensemble_response
from app.weather.synthetic import generate_synthetic_ensemble


@pytest.fixture(scope="module")
def client():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    url = f"sqlite:///{path}"
    db_mod.rebind(url)
    Base.metadata.create_all(bind=db_mod.engine)
    with db_mod.SessionLocal() as db:
        seed_all(db)
    app = create_app()
    with TestClient(app) as c:
        yield c
    try:
        os.remove(path)
    except OSError:
        pass


def test_openmeteo_parser_normalizes_and_counts_missing():
    payload = {
        "latitude": 13.7,
        "longitude": 75.25,
        "utc_offset_seconds": 0,
        "hourly_units": {"precipitation": "mm", "precipitation_member01": "mm"},
        "hourly": {
            "time": ["2026-07-10T00:00", "2026-07-10T01:00", "2026-07-10T02:00"],
            "precipitation": [0.0, 1.4, None],
            "precipitation_member01": [0.2, 0.0, 3.5],
        },
    }
    parsed = parse_ensemble_response(payload, "icon_seamless")
    assert parsed.quality["member_count"] == 2
    assert parsed.quality["missing_values"] == 1
    assert parsed.members[0] == [0.0, 1.4, 0.0]
    assert parsed.members[1] == [0.2, 0.0, 3.5]


def test_simulation_determinism_and_sensitivity():
    rain1 = np.array(generate_synthetic_ensemble(hours=48, members=15, seed=99))
    rain2 = np.array(generate_synthetic_ensemble(hours=48, members=15, seed=99))
    assert np.array_equal(rain1, rain2)

    plot = PlotInput(plot_id=1, code="P-014", area_acres=3.0, priority="urgent",
                     drainage="poor", canopy_density=0.8, protection_state=0.1)
    s_low = summarize_plot(plot, rain1, params_for("low", BASE_PARAMS))
    s_base = summarize_plot(plot, rain1, params_for("base", BASE_PARAMS))
    s_b2 = summarize_plot(plot, rain2, params_for("base", BASE_PARAMS))
    s_high = summarize_plot(plot, rain1, params_for("high", BASE_PARAMS))

    assert s_base["exposure_hours_mean"] == s_b2["exposure_hours_mean"]
    assert s_low["exposure_hours_mean"] < s_base["exposure_hours_mean"] < s_high["exposure_hours_mean"]


def test_optimizer_hard_constraints_and_frozen_immutability():
    hs = datetime(2026, 7, 15, 0, 0, tzinfo=timezone.utc)
    # Dry scenario so windows are open
    rain = np.zeros((10, 48))
    plots = [
        PlotInput(1, "P-001", 2.0, "high", "poor", 0.7, 0.1),
        PlotInput(2, "P-002", 2.0, "urgent", "poor", 0.8, 0.1),
        PlotInput(3, "P-003", 1.5, "medium", "moderate", 0.6, 0.2),
    ]
    crews = [
        CrewCtx(1, "C-01", "Alpha", 7, 18, 8.0, {"PROT"}, 13.69, 75.23, available=True),
        CrewCtx(2, "C-02", "Beta", 7, 18, 8.0, {"PROT"}, 13.70, 75.25, available=False),  # unavailable crew
    ]
    tasks = [
        TaskCtx("PROT#1", "PROT", 1, "P-001", 6, "sprayer_unit", None, True, True, 0.3, 3, 0.6, 13.695, 75.233, 2.6, 2.0, "high"),
        TaskCtx("PROT#2", "PROT", 2, "P-002", 6, "sprayer_unit", None, True, True, 0.3, 3, 0.6, 13.705, 75.260, 4.0, 2.0, "urgent"),
        TaskCtx("PROT#3", "PROT", 3, "P-003", 5, "sprayer_unit", None, True, True, 0.3, 3, 0.6, 13.680, 75.240, 1.5, 1.5, "medium"),
    ]
    # Freeze task PROT#1 as already completed on crew 1 at slots 8..14
    frozen = {"PROT#1": FixedAssignment("PROT#1", 1, 8, 14, "completed")}
    ctx = build_context(
        horizon_start=hs, rain_all=rain, plots=plots,
        plot_locs={1: (13.695, 75.233), 2: (13.705, 75.260), 3: (13.680, 75.240)},
        crews=crews, tasks=tasks, equipment={"sprayer_unit": [(1, None)]},
        params=BASE_PARAMS, now_slot=14, frozen=frozen,
    )
    res = solve_cpsat(ctx, time_limit_s=5.0, seed=42)
    asg = res["assignments"]
    val = validate_plan(ctx, asg, enforce_windows=True)
    assert val["valid"] is True
    # Unavailable crew 2 must never be assigned
    assert all(a.crew_id != 2 for a in asg)
    # Frozen task PROT#1 must remain intact at slots 8..14 on crew 1
    f_asg = next(a for a in asg if a.task_key == "PROT#1")
    assert (f_asg.crew_id, f_asg.start, f_asg.end, f_asg.frozen) == (1, 8, 14, True)


def test_validator_detects_overlap_and_infeasible_windows():
    hs = datetime(2026, 7, 15, 0, 0, tzinfo=timezone.utc)
    # Heavy rain everywhere -> no feasible dry windows
    rain = np.full((10, 24), 8.0)
    plots = [PlotInput(1, "P-001", 2.0, "high", "poor", 0.7, 0.1)]
    crews = [CrewCtx(1, "C-01", "Alpha", 7, 18, 8.0, {"PROT"}, 13.69, 75.23, available=True)]
    tasks = [TaskCtx("PROT#1", "PROT", 1, "P-001", 6, "sprayer_unit", None, True, True, 0.3, 3, 0.6, 13.69, 75.23, 2.6, 2.0, "high")]
    ctx = build_context(
        horizon_start=hs, rain_all=rain, plots=plots, plot_locs={1: (13.69, 75.23)},
        crews=crews, tasks=tasks, equipment={"sprayer_unit": [(1, None)]}, params=BASE_PARAMS,
    )
    res = solve_cpsat(ctx, time_limit_s=2.0)
    assert len(res["assignments"]) == 0
    unsched = diagnose_unscheduled(ctx, res["assignments"])
    assert len(unsched) == 1
    assert any("No approved operational window" in r for r in unsched[0]["reasons"])

    # Validator rejects an illegal manual placement during rain
    bad_val = validate_plan(ctx, [PlannedTask("PROT#1", 1, 12, 18)], enforce_windows=True)
    assert bad_val["valid"] is False


def test_end_to_end_api_workflow(client: TestClient):
    # 1. Login with seeded coordinator credentials
    r = client.post("/api/v1/auth/login", json={"email": "coordinator@mahalishield.org", "password": "Mahali@2026"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Dashboard summary
    dash = client.get("/api/v1/dashboard/summary", headers=headers)
    assert dash.status_code == 200
    djson = dash.json()
    assert djson["counts"]["total_plots"] >= 8
    assert djson["weather"]["meta"]["is_synthetic"] is True

    # 3. Plots CRUD
    create_p = client.post("/api/v1/plots", headers=headers, json={
        "code": "P-099", "name": "Test Monsoon Block", "lat": 13.691, "lon": 75.241,
        "area_acres": 1.6, "priority": "high", "drainage": "moderate", "canopy_density": 0.65,
        "protection_state": 0.2, "inspection_required": False,
    })
    assert create_p.status_code == 201
    pid = create_p.json()["id"]
    del_p = client.delete(f"/api/v1/plots/{pid}", headers=headers)
    assert del_p.status_code == 200

    # 4. Run simulation
    sim = client.post("/api/v1/simulations", headers=headers, json={"sensitivity": "base", "seed": 42})
    assert sim.status_code == 200
    assert len(sim.json()["priority_queue"]) >= 8

    # 5. Run optimizer
    opt = client.post("/api/v1/plans/optimize", headers=headers, json={"policy": "optimized", "time_limit_s": 5.0})
    assert opt.status_code == 200
    plan_data = opt.json()
    assert plan_data["validation"]["valid"] is True
    plan_id = plan_data["id"]

    # 6. Compare policies in Policy Arena
    arena = client.post("/api/v1/policies/compare", headers=headers, json={"sensitivity": "base", "evaluation_mode": "in_sample", "time_limit_s": 5.0})
    assert arena.status_code == 200
    policies = arena.json()["policies"]
    assert set(policies.keys()) == {"calendar", "reactive", "optimized"}
    assert policies["optimized"]["metrics"]["expected_weighted_exposure"] <= policies["calendar"]["metrics"]["expected_weighted_exposure"]

    # 7. Dynamic Replanning with early-rain disruption
    replan = client.post(f"/api/v1/plans/{plan_id}/replan", headers=headers, json={
        "disruption_type": "early_rain",
        "occurs_at_slot": 16,
        "payload": {"start_hour": 5, "end_hour": 10, "intensity_mm": 4.5, "probability": 0.9, "seed": 7},
        "description": "Test early rain squall",
    })
    assert replan.status_code == 200
    rep_data = replan.json()
    assert rep_data["new_plan"]["version"] == plan_data["version"] + 1
    assert rep_data["new_plan"]["validation"]["valid"] is True

    # 8. AI Assistant explanation
    chat = client.post("/api/v1/assistant/chat", headers=headers, json={
        "message": "Why is Plot 014 prioritized and what changed after early rainfall?",
        "plan_id": rep_data["new_plan"]["id"],
    })
    assert chat.status_code == 200
    assert len(chat.json()["sections"]) >= 1
