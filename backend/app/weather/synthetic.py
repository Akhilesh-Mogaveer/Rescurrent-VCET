"""Seeded synthetic monsoon rainfall scenario generator (clearly labelled SYNTHETIC).

The generator produces an ensemble with a shared regime (alternating wet spells and
breaks) whose break timing, length and intensity vary per member. It is a stochastic
weather-generator style construction for demonstration; it is NOT a forecast.
"""
from __future__ import annotations

import numpy as np


def generate_synthetic_ensemble(hours: int = 72, members: int = 30, seed: int = 42,
                                start_local_hour: int = 6, wetness: float = 1.0) -> list[list[float]]:
    rng = np.random.default_rng(seed)
    # Shared regime: break centres (hours from start) with nominal lengths
    base_breaks = [(3.0, 9.0), (26.0, 10.0), (50.0, 8.0)]
    out: list[list[float]] = []
    local_hours = (np.arange(hours) + start_local_hour) % 24
    # Afternoon convective enhancement typical of monsoon diurnal cycle (assumption)
    diurnal = 1.0 + 0.6 * np.exp(-((local_hours - 15.0) ** 2) / (2 * 3.0 ** 2))
    for _ in range(members):
        wet_mask = np.ones(hours, dtype=bool)
        for centre, length in base_breaks:
            c = centre + rng.normal(0, 1.5)
            ln = max(4.0, length + rng.normal(0, 1.2))
            a, b = int(max(0, round(c))), int(min(hours, round(c + ln)))
            wet_mask[a:b] = False
        # occasional extra short break or shower interrupting a break
        if rng.random() < 0.15:
            s = int(rng.integers(0, hours - 3))
            wet_mask[s:s + int(rng.integers(1, 2))] = ~wet_mask[s]
        intensity_scale = rng.lognormal(mean=0.0, sigma=0.30) * wetness
        rain = np.zeros(hours)
        for h in range(hours):
            if wet_mask[h]:
                # Gamma-distributed hourly amounts during monsoon spells
                if rng.random() < 0.88:
                    rain[h] = rng.gamma(shape=1.1, scale=2.4) * diurnal[h] * intensity_scale
            else:
                if rng.random() < 0.04:
                    rain[h] = rng.gamma(shape=0.5, scale=0.3)
        out.append([round(float(x), 2) for x in rain])
    return out


def apply_early_rain(members: list[list[float]], start_hour: int, end_hour: int, intensity_mm: float,
                     probability: float = 1.0, seed: int = 7) -> list[list[float]]:
    """Inject rain earlier than expected into [start_hour, end_hour) for a fraction of members."""
    rng = np.random.default_rng(seed)
    result = []
    for m in members:
        arr = np.array(m, dtype=float)
        if rng.random() <= probability:
            a, b = max(0, start_hour), min(len(arr), end_hour)
            arr[a:b] = np.maximum(arr[a:b], intensity_mm * rng.uniform(0.7, 1.3, size=max(0, b - a)))
        result.append([round(float(x), 2) for x in arr])
    return result
