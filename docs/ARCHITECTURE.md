# MahaliShield — Technical Architecture & Scientific Governance

## 1. System Overview

MahaliShield is an uncertainty-aware farm protection planning and decision-intelligence platform for arecanut growers and cooperative coordinators during monsoon periods.

```
mahali-shield/
├── backend/
│   ├── app/
│   │   ├── api/            # Versioned FastAPI REST endpoints (/api/v1)
│   │   ├── assistant/      # Grounded explanation engine + validated constraint parser
│   │   ├── core/           # Settings, SQLAlchemy engine, JWT auth, RBAC dependencies
│   │   ├── models/         # Relational database models (16 tables)
│   │   ├── optimization/   # PlanningContext, OR-Tools CP-SAT model, list scheduler, independent validator
│   │   ├── policies/       # Policy Arena (Calendar A, Reactive B, MahaliShield Optimized C)
│   │   ├── schemas/        # Pydantic v2 request/response schemas
│   │   ├── services/       # Audit, notifications, planning orchestration, deterministic seed
│   │   ├── simulation/     # Conceptual Wetness W(t), Hazard H(t), Protection P(t), Exposure E(t) twin
│   │   ├── weather/        # Open-Meteo Ensemble API client, caching, synthetic generator
│   │   └── main.py         # FastAPI application entry point
│   ├── tests/              # Automated pytest suite
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── context/        # Auth, bilingual i18n (EN/KN), toast & notification state
│   │   ├── layouts/        # Responsive enterprise sidebar & header shell
│   │   ├── pages/          # All 14 operational screens
│   │   ├── services/       # Typed API client + offline localStorage plan cache
│   │   ├── types/          # Shared TypeScript interfaces
│   │   └── utils/          # English & Kannada translations
│   ├── Dockerfile
│   └── package.json
├── docs/
│   └── ARCHITECTURE.md
├── .env.example
├── .gitignore
├── docker-compose.yml
└── README.md
```

## 2. Mathematical Optimization & Independent Validation

1. **Objective**: Minimize expected weighted relative exposure across ensemble rainfall members.
2. **Hard Constraints**:
   - Crew exclusivity + haversine road travel buffers (`NoOverlap` + pairwise travel disjunctions)
   - Task duration (`setup_minutes + minutes_per_acre * area_acres`)
   - Crew working shifts & unavailability windows
   - Time-varying equipment capacity (`AddCumulative` with failure blocking intervals)
   - Approved dry-window probability threshold (`window_prob >= min_window_probability`)
   - Crew daily working-hour limits
   - Task precedence (`INSP -> PROT`)
   - Immutability of completed/in-progress tasks during dynamic replanning (`frozen = True`)
3. **Independent Validator**: `app/optimization/validator.py` verifies all 11 constraint families from first principles without reusing solver variables.
