# MahaliShield

### Uncertainty-Aware Farm Protection Planning for Arecanut Fruit-Rot Risk
**Tagline:** *Win the gaps between the rains.*

MahaliShield is a full-stack agricultural decision-intelligence platform that helps arecanut growers and cooperative coordinators in monsoon regions (such as Thirthahalli taluk, Shivamogga district, Karnataka) plan expert-approved protection operations during uncertain rainfall breaks.

> **Important Scientific Scope Notice**
> MahaliShield is an operational decision-support and scheduling platform — **not** an autonomous disease diagnosis or pesticide prescription system. The Agricultural Risk & Protection Twin computes a dimensionless **relative simulated exposure index** $E(t) = H(t) \times (1 - P(t))$ from configurable wetness, hazard, and wash-off assumptions. Simulated outcomes are never presented as calibrated koleroga disease probabilities or field-proven incidence.

---

## 1. Architecture & Technology Stack

- **Frontend (`frontend/`)**: React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, React-Leaflet (OpenStreetMap), Lucide React icons, Vitest + React Testing Library.
- **Backend (`backend/`)**: Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2.0 (SQLite default; PostgreSQL-ready via `DATABASE_URL`), JWT authentication (`python-jose` + `bcrypt`).
- **Simulation & Mathematical Optimization**:
  - **Weather Engine (`app/weather/`)**: Open-Meteo Ensemble API client + unit normalization + missing-data accounting + cached & seeded synthetic monsoon scenario fallback (`seed=42` & `seed=108`).
  - **Agricultural Risk & Protection Twin (`app/simulation/twin.py`)**: Vectorized NumPy state-space simulation of Wetness Proxy $W(t)$, Environmental Hazard Proxy $H(t)$, Protection State $P(t)$, and Relative Exposure $E(t)$ across `low`, `base`, and `high` sensitivity parameter sets.
  - **Mathematical Optimizer (`app/optimization/cpsat.py`)**: Google OR-Tools **CP-SAT** scheduler minimizing expected weighted relative exposure subject to 9 hard operational constraints (crew exclusivity, task duration, crew shifts/availability, equipment capacity, haversine road travel buffers, approved dry-window probabilities, daily hour caps, `INSP -> PROT` precedence, and frozen completed work), backed by a cost-aware greedy fallback and an independent first-principles plan validator (`app/optimization/validator.py`).
  - **Policy Arena (`app/policies/arena.py`)**: Fair side-by-side comparison of **Policy A (Calendar-Based)**, **Policy B (Reactive First-Window)**, and **Policy C (MahaliShield CP-SAT Optimized)** on identical initial conditions, scenarios, crews, tasks, and constraints.
  - **Dynamic Replanning (`app/services/planning.py`)**: Supports 6 disruption types (`early_rain`, `crew_unavailable`, `equipment_failure`, `urgent_priority`, `task_overrun`, `weather_unavailable`), strictly freezes completed/in-progress tasks, re-optimizes remaining work, validates the new plan, and computes a per-task diff with reasons.
  - **AI Explanation Assistant (`app/assistant/service.py`)**: Explains computed prioritization, crew assignments, window selection, unscheduled tasks, and replanning diffs from validated database records, with optional Gemini JSON constraint parsing + strict Pydantic & business-rule validation.

---

## 2. Demo Credentials (First-Run Seeded Cluster)

On startup, the backend automatically seeds the **Thirthahalli Arecanut Cooperative** synthetic demo cluster (4 farms, 8 plots including flagship `P-014`, 4 crews `C-01..C-04`, 4 equipment units, 30-member synthetic monsoon ensemble, initial simulation run, and approved CP-SAT Plan #1).

| Role | Email | Password | Capabilities |
| :--- | :--- | :--- | :--- |
| **Cooperative Coordinator** | `coordinator@mahalishield.org` | `Mahali@2026` | Full Command Center, CRUD, CP-SAT Optimizer, Gantt, Policy Arena, Dynamic Replanning |
| **Farmer / Grower** | `farmer@mahalishield.org` | `Mahali@2026` | Grower Advisory view, interactive map, why prioritized, offline cached plan, English/Kannada toggle |
| **Agricultural Expert / Admin** | `expert@mahalishield.org` | `Mahali@2026` | Model governance, parameter provenance, expert review sign-off, user role management |

---

## 3. Running Locally

### Backend (FastAPI + OR-Tools CP-SAT)
```powershell
cd backend
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
- Interactive OpenAPI Docs: `http://127.0.0.1:8000/docs`
- Health Check: `http://127.0.0.1:8000/health`

### Frontend (React + TypeScript + Vite)
```powershell
cd frontend
npm run dev
```
- Web Application: `http://localhost:5173`

---

## 4. Running Automated Tests

### Backend Test Suite (Pytest)
```powershell
cd backend
.\.venv\Scripts\python -m pytest -v
```

### Frontend Test Suite & Production Build (Vitest + TypeScript)
```powershell
cd frontend
npx vitest run
npm run build
```
