"""Transparent agricultural risk & protection twin.

CONCEPTUAL MODEL — NOT A VALIDATED KOLEROGA (FRUIT-ROT) DISEASE MODEL.

    W[t] = clip(retention * W[t-1] + (1 - retention) * min(1, R[t] / r_sat) + rain_boost * 1[R[t] > 0], 0, 1)
    D[t] = consecutive hours with W > wet_threshold
    H[t] = W[t] ** gamma * (1 - exp(-D[t] / tau_wet))
    P[t] = P[t-1] * exp(-lambda_decay) * exp(-k_wash * R[t]),  P := max(P, efficacy) at application
    E[t] = H[t] * (1 - P[t])

All quantities are dimensionless relative indices in [0, 1]. E is a *relative simulated
exposure index* — never a disease probability. Every coefficient is a configurable
MODEL ASSUMPTION with low/base/high sensitivity variants pending expert review.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

import numpy as np

MODEL_VERSION = "twin-0.3.0"

PRIORITY_WEIGHTS = {"low": 0.8, "medium": 1.0, "high": 1.3, "urgent": 2.0}
DRAINAGE_RETENTION_DELTA = {"poor": 0.05, "moderate": 0.0, "good": -0.07}

BASE_PARAMS: dict[str, float] = {
    "rain_saturation_mm": 2.0,
    "wetness_retention": 0.86,
    "rain_boost": 0.05,
    "canopy_retention_gain": 0.06,
    "wet_threshold": 0.45,
    "hazard_gamma": 1.4,
    "tau_wet_hours": 10.0,
    "initial_wetness": 0.6,
    "initial_wet_hours": 6.0,
    "protection_efficacy": 0.85,
    "protection_decay_per_day": 0.05,
    "washoff_per_mm": 0.006,
    "early_washoff_per_mm": 0.10,
}

SENSITIVITY_MULTIPLIERS: dict[str, dict[str, float]] = {
    "low": {"wetness_retention": 0.97, "tau_wet_hours": 1.3, "protection_decay_per_day": 0.7,
            "washoff_per_mm": 0.7, "early_washoff_per_mm": 0.7, "hazard_gamma": 1.15},
    "base": {},
    "high": {"wetness_retention": 1.03, "tau_wet_hours": 0.75, "protection_decay_per_day": 1.4,
             "washoff_per_mm": 1.4, "early_washoff_per_mm": 1.4, "hazard_gamma": 0.85},
}

PARAM_DOCS: dict[str, dict[str, str]] = {
    "rain_saturation_mm": {"unit": "mm/h", "meaning": "Hourly rainfall at which the wetness input saturates"},
    "wetness_retention": {"unit": "fraction/h", "meaning": "Share of wetness retained each hour (drying speed)"},
    "rain_boost": {"unit": "index", "meaning": "Additional wetness added in any hour with rain"},
    "canopy_retention_gain": {"unit": "fraction", "meaning": "Extra retention per unit canopy density (shade slows drying)"},
    "wet_threshold": {"unit": "index", "meaning": "Wetness above which an hour counts as 'wet' for duration"},
    "hazard_gamma": {"unit": "-", "meaning": "Non-linearity of hazard with respect to wetness"},
    "tau_wet_hours": {"unit": "h", "meaning": "Wet duration scale for hazard build-up"},
    "initial_wetness": {"unit": "index", "meaning": "Wetness at start of horizon (monsoon antecedent)"},
    "initial_wet_hours": {"unit": "h", "meaning": "Wet duration already accumulated at horizon start"},
    "protection_efficacy": {"unit": "index", "meaning": "Protection state immediately after a successful operation"},
    "protection_decay_per_day": {"unit": "1/day", "meaning": "Background decay of the protection state"},
    "washoff_per_mm": {"unit": "1/mm", "meaning": "Protection loss per mm of rain after establishment"},
    "early_washoff_per_mm": {"unit": "1/mm", "meaning": "Efficacy loss per mm of rain within the drying period"},
}


def params_for(sensitivity: str, base: dict[str, float] | None = None) -> dict[str, float]:
    p = dict(base or BASE_PARAMS)
    for k, m in SENSITIVITY_MULTIPLIERS.get(sensitivity, {}).items():
        p[k] = p[k] * m
    p["wetness_retention"] = min(0.98, p["wetness_retention"])
    return p


@dataclass
class PlotInput:
    plot_id: int
    code: str
    area_acres: float
    priority: str
    drainage: str
    canopy_density: float
    protection_state: float

    @property
    def weight(self) -> float:
        return self.area_acres * PRIORITY_WEIGHTS.get(self.priority, 1.0)


def plot_retention(plot: PlotInput, params: dict[str, float]) -> float:
    r = params["wetness_retention"] + DRAINAGE_RETENTION_DELTA.get(plot.drainage, 0.0) \
        + params["canopy_retention_gain"] * (plot.canopy_density - 0.5)
    return float(np.clip(r, 0.5, 0.985))


def wetness_and_hazard(plot: PlotInput, rain: np.ndarray, params: dict[str, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """rain: (S, T) mm/h. Returns W, D, H each (S, T)."""
    S, T = rain.shape
    ret = plot_retention(plot, params)
    W = np.zeros((S, T))
    D = np.zeros((S, T))
    w = np.full(S, params["initial_wetness"])
    d = np.full(S, params["initial_wet_hours"])
    sat = params["rain_saturation_mm"]
    for t in range(T):
        r = rain[:, t]
        w = np.clip(ret * w + (1 - ret) * np.minimum(1.0, r / sat) + params["rain_boost"] * (r > 0.1), 0.0, 1.0)
        d = np.where(w > params["wet_threshold"], d + 1.0, 0.0)
        W[:, t] = w
        D[:, t] = d
    H = np.power(W, params["hazard_gamma"]) * (1.0 - np.exp(-D / params["tau_wet_hours"]))
    return W, D, H


def protection_decay_log(rain: np.ndarray, params: dict[str, float]) -> np.ndarray:
    """Per-hour log decay factors (S, T)."""
    lam = params["protection_decay_per_day"] / 24.0
    return -lam - params["washoff_per_mm"] * rain


def efficacy_matrix(rain: np.ndarray, op_hours: int, max_rain: float, dry_hours: int,
                    params: dict[str, float]) -> np.ndarray:
    """Efficacy (S, T+1) if an operation completes at hour index a (a in 0..T).

    Operation occupies hours [a-op_hours, a); drying period [a, a+dry_hours).
    Rain above ``max_rain`` during the operation means it could not be carried out (efficacy 0).
    """
    S, T = rain.shape
    eff = np.zeros((S, T + 1))
    padded = np.concatenate([rain, np.zeros((S, dry_hours + 1))], axis=1)
    for a in range(T + 1):
        lo = max(0, a - op_hours)
        op_ok = np.all(rain[:, lo:a] <= max_rain, axis=1) if a > lo else np.ones(S, dtype=bool)
        dry_rain = padded[:, a:a + dry_hours].sum(axis=1)
        eff[:, a] = params["protection_efficacy"] * op_ok * np.exp(-params["early_washoff_per_mm"] * dry_rain)
    return eff


def protection_trajectory(plot: PlotInput, rain: np.ndarray, params: dict[str, float],
                          application_hour: np.ndarray | None, efficacy: np.ndarray | None) -> np.ndarray:
    """Protection P (S, T). application_hour: (S,) int completion hour index or -1 for none."""
    S, T = rain.shape
    logd = protection_decay_log(rain, params)
    P = np.zeros((S, T))
    p = np.full(S, plot.protection_state)
    for t in range(T):
        if application_hour is not None and efficacy is not None:
            apply_now = application_hour == t
            p = np.where(apply_now, np.maximum(p, efficacy), p)
        p = p * np.exp(logd[:, t])
        P[:, t] = p
    return P


def exposure_sum_by_completion(plot: PlotInput, rain: np.ndarray, H: np.ndarray, eff: np.ndarray,
                               params: dict[str, float]) -> np.ndarray:
    """Exposure-hours sum (S, T+1) as a function of completion hour a; column T = no operation.

    P_h = max(P0 * exp(L_h), eff_a * exp(L_h - L_{a-1})) for h >= a  (protection applied at start of hour a)
    """
    S, T = rain.shape
    logd = protection_decay_log(rain, params)
    L = np.cumsum(logd, axis=1)  # L_h = sum_{u<=h}
    base_P = plot.protection_state * np.exp(L)  # (S, T)
    base_E = H * (1.0 - base_P)
    out = np.zeros((S, T + 1))
    out[:, T] = base_E.sum(axis=1)
    cum_base = np.concatenate([np.zeros((S, 1)), np.cumsum(base_E, axis=1)], axis=1)  # prefix sums
    for a in range(T):
        Lprev = L[:, a - 1:a] if a > 0 else np.zeros((S, 1))
        Pa = np.maximum(base_P[:, a:], eff[:, a:a + 1] * np.exp(L[:, a:] - Lprev))
        out[:, a] = cum_base[:, a] + (H[:, a:] * (1.0 - Pa)).sum(axis=1)
    return out


def input_hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def summarize_plot(plot: PlotInput, rain: np.ndarray, params: dict[str, float]) -> dict[str, Any]:
    """No-action simulation summary used by the risk twin screen and the priority queue."""
    W, D, H = wetness_and_hazard(plot, rain, params)
    P = protection_trajectory(plot, rain, params, None, None)
    E = H * (1.0 - P)
    exp_sum = E.sum(axis=1)

    def q(a: np.ndarray) -> dict[str, list[float]]:
        return {k: [round(float(x), 4) for x in np.percentile(a, p, axis=0)] for k, p in
                (("p10", 10), ("p50", 50), ("p90", 90))}

    mean_W = float(W.mean())
    wet_hours = float((W > params["wet_threshold"]).sum(axis=1).mean())
    return {
        "plot_id": plot.plot_id,
        "code": plot.code,
        "weight": round(plot.weight, 3),
        "series": {"wetness": q(W), "hazard": q(H), "protection": q(P), "exposure": q(E)},
        "exposure_hours_mean": round(float(exp_sum.mean()), 3),
        "exposure_hours_p90": round(float(np.percentile(exp_sum, 90)), 3),
        "weighted_exposure_mean": round(float(exp_sum.mean() * plot.weight), 3),
        "mean_wetness": round(mean_W, 3),
        "expected_wet_hours": round(wet_hours, 2),
        "current_protection": round(plot.protection_state, 3),
        "protection_end_median": round(float(np.median(P[:, -1])), 3),
        "retention": round(plot_retention(plot, params), 3),
    }


def build_priority_queue(summaries: list[dict[str, Any]], plots: dict[int, PlotInput]) -> list[dict[str, Any]]:
    ranked = sorted(summaries, key=lambda s: -s["weighted_exposure_mean"])
    total = sum(s["weighted_exposure_mean"] for s in ranked) or 1.0
    queue = []
    for rank, s in enumerate(ranked, start=1):
        p = plots[s["plot_id"]]
        factors = []
        if s["expected_wet_hours"] > 40:
            factors.append(f"long expected wetness ({s['expected_wet_hours']:.0f} of horizon hours wet)")
        if p.drainage == "poor":
            factors.append("poor drainage slows drying (assumption)")
        if p.canopy_density >= 0.7:
            factors.append(f"dense canopy {p.canopy_density:.2f} slows drying (assumption)")
        if p.protection_state < 0.2:
            factors.append(f"low current protection state ({p.protection_state:.2f})")
        if p.priority in ("high", "urgent"):
            factors.append(f"coordinator priority '{p.priority}' (weight {PRIORITY_WEIGHTS[p.priority]})")
        if p.area_acres >= 2.5:
            factors.append(f"large area ({p.area_acres} acres)")
        queue.append({
            "rank": rank,
            "plot_id": s["plot_id"],
            "code": s["code"],
            "score": s["weighted_exposure_mean"],
            "share": round(s["weighted_exposure_mean"] / total, 4),
            "exposure_hours_mean": s["exposure_hours_mean"],
            "exposure_hours_p90": s["exposure_hours_p90"],
            "factors": factors or ["no single dominant factor; rank driven by combined simulated exposure"],
        })
    return queue
