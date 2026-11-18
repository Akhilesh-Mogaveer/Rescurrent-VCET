export interface User {
  id: number;
  email: string;
  full_name: string;
  role: 'farmer' | 'coordinator' | 'admin';
  is_active: boolean;
  language: 'en' | 'kn';
  phone?: string | null;
  preferences: Record<string, unknown>;
}

export interface WeatherMeta {
  id: number;
  label: string;
  source_type: 'live' | 'synthetic' | 'replay' | 'derived';
  provider: string;
  model: string;
  run_time?: string | null;
  fetched_at: string;
  horizon_start: string;
  hours: number;
  member_count: number;
  request_location: [number, number];
  grid_location?: [number, number] | null;
  seed?: number | null;
  parent_set_id?: number | null;
  modification?: Record<string, unknown> | null;
  quality: Record<string, unknown>;
  age_hours: number;
  is_stale: boolean;
  is_synthetic: boolean;
  evidence_label: string;
}

export interface DryWindow {
  start_hour: number;
  end_hour: number;
  start_time: string;
  latest_start_time: string;
  max_probability: number;
  mean_probability: number;
  rain_return_risk_at_best: number;
}

export interface PlotItem {
  id: number;
  code: string;
  farm_id: number;
  farm_name: string;
  grower_name?: string | null;
  name: string;
  lat: number;
  lon: number;
  area_acres: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'scheduled' | 'protected' | 'inactive';
  drainage: 'poor' | 'moderate' | 'good';
  canopy_density: number;
  protection_state: number;
  inspection_required: boolean;
  assigned_crew_id?: number | null;
  assigned_crew_code?: string | null;
  assigned_crew_name?: string | null;
  notes?: string | null;
  is_synthetic: boolean;
  updated_at: string;
  simulated_exposure?: {
    exposure_hours_mean: number;
    exposure_hours_p90: number;
    weighted_exposure_mean: number;
    mean_wetness: number;
    current_protection: number;
  } | null;
}

export interface CrewItem {
  id: number;
  code: string;
  name: string;
  leader?: string | null;
  size: number;
  is_available: boolean;
  shift_start_hour: number;
  shift_end_hour: number;
  max_hours_per_day: number;
  eligibility: string[];
  base_lat: number;
  base_lon: number;
  unavailable_periods: { start: string; end: string; reason?: string }[];
  current_assignment?: string | null;
  scheduled_task_count?: number;
  is_synthetic: boolean;
}

export interface EquipmentItem {
  id: number;
  code: string;
  type: string;
  name: string;
  capacity: number;
  status: 'operational' | 'maintenance' | 'failed';
  is_available: boolean;
  notes?: string | null;
  is_synthetic: boolean;
}

export interface TaskRuleItem {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  setup_minutes: number;
  minutes_per_acre: number;
  required_equipment_type?: string | null;
  requires_dry_window: boolean;
  max_rain_mm_per_hour: number;
  dry_hours_after: number;
  min_window_probability: number;
  predecessor_code?: string | null;
  applies_to: string;
  affects_protection: boolean;
  is_active: boolean;
  approved_by?: string | null;
  evidence_label: string;
}

export interface AssignmentItem {
  id: number;
  task_key: string;
  task_code: string;
  plot_id: number;
  plot_code: string;
  plot_name: string;
  plot_area_acres: number;
  plot_priority: string;
  crew_id: number;
  crew_code: string;
  crew_name: string;
  equipment_type?: string | null;
  start_slot: number;
  end_slot: number;
  duration_minutes: number;
  travel_slots: number;
  travel_minutes: number;
  start_time: string;
  end_time: string;
  status: 'planned' | 'in_progress' | 'completed';
  frozen: boolean;
  window_probability?: number | null;
  expected_exposure?: number | null;
  exposure_if_unprotected?: number | null;
  explanation?: {
    window_probability?: number;
    approved_min_probability?: number;
    expected_weighted_exposure?: number;
    weighted_exposure_if_unprotected?: number;
    expected_reduction?: number;
    plot_weight?: number;
    duration_minutes?: number;
    local_start?: string;
    frozen?: boolean;
    factors?: string[];
    crew_alternatives?: string[];
  };
}

export interface PlanItem {
  id: number;
  name: string;
  lineage_id: number;
  version: number;
  parent_plan_id?: number | null;
  status: 'draft' | 'approved' | 'superseded' | 'rejected';
  policy: string;
  scenario_set_id: number;
  scenario_set_label?: string | null;
  scenario_source_type?: string | null;
  parameter_set_id: number;
  parameter_version?: string | null;
  simulation_run_id?: number | null;
  horizon_start: string;
  horizon_hours: number;
  now_slot: number;
  context: Record<string, unknown>;
  solver: {
    engine?: string;
    status?: string;
    solve_time_s?: number;
    total_time_s?: number;
    objective?: number;
    best_bound?: number;
    gap?: number;
    optimality_claim?: string;
    fallback_used?: boolean;
    variables?: number;
    constraints?: number;
    infeasibility?: string;
  };
  validation: {
    valid: boolean;
    assignment_count: number;
    checks: { check: string; passed: boolean; violations: string[]; violation_count: number }[];
  };
  unscheduled: {
    task_key: string;
    task_code: string;
    plot_id: number;
    plot_code: string;
    reasons: string[];
    exposure_if_unprotected: number;
  }[];
  metrics: Record<string, number>;
  diff?: {
    task_key: string;
    plot_code: string;
    change: string;
    reasons: string[];
    previous?: { crew_id: number; crew_code?: string; start_slot: number; end_slot: number; start_time: string } | null;
    new?: { crew_id: number; crew_code?: string; start_slot: number; end_slot: number; start_time: string } | null;
  }[] | null;
  disruption_event_id?: number | null;
  created_at: string;
  approved_at?: string | null;
  assignments?: AssignmentItem[];
}

export interface PriorityQueueItem {
  rank: number;
  plot_id: number;
  code: string;
  score: number;
  share: number;
  exposure_hours_mean: number;
  exposure_hours_p90: number;
  factors: string[];
}
