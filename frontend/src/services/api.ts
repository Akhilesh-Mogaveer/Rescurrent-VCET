import type { PlanItem, User } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
const TOKEN_KEY = 'mahalishield_token';
const USER_KEY = 'mahalishield_user';
const OFFLINE_PLAN_KEY = 'mahalishield_latest_approved_plan';
const OFFLINE_SUMMARY_KEY = 'mahalishield_latest_dashboard_summary';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function cacheApprovedPlan(plan: PlanItem | null | undefined): void {
  if (!plan) return;
  try {
    localStorage.setItem(OFFLINE_PLAN_KEY, JSON.stringify({ cached_at: new Date().toISOString(), plan }));
  } catch {
    // ignore storage quota errors
  }
}

export function getCachedApprovedPlan(): { cached_at: string; plan: PlanItem } | null {
  const raw = localStorage.getItem(OFFLINE_PLAN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function cacheDashboardSummary(summary: unknown): void {
  try {
    localStorage.setItem(OFFLINE_SUMMARY_KEY, JSON.stringify({ cached_at: new Date().toISOString(), summary }));
  } catch {
    // ignore
  }
}

export function getCachedDashboardSummary(): { cached_at: string; summary: any } | null {
  const raw = localStorage.getItem(OFFLINE_SUMMARY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const errJson = await resp.json();
      detail = errJson.detail || errJson.message || detail;
    } catch {
      // ignore
    }
    throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail), resp.status);
  }
  return (await resp.json()) as T;
}
