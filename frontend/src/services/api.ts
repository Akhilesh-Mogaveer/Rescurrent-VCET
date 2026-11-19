import type { PlanItem, User } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
const TOKEN_KEY = 'mahalishield_token';
const USER_KEY = 'mahalishield_user';
const OFFLINE_PLAN_KEY = 'mahalishield_latest_approved_plan';
const OFFLINE_SUMMARY_KEY = 'mahalishield_latest_dashboard_summary';

// Clean up legacy persistent localStorage auth on startup so opening the app starts at the authentication page
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  }
} catch {
  // ignore
}

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): User | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: User): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export function clearAuthSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
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
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (netErr: any) {
    throw new ApiError(
      `Cannot connect to backend server. Please verify the backend is running on http://127.0.0.1:8000 (${netErr?.message || 'Network error'}).`,
      0,
    );
  }

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const errJson = await resp.json();
      detail = errJson.detail || errJson.message || detail;
    } catch {
      if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
        detail = `Backend API is offline or unreachable (HTTP ${resp.status}). Please ensure the backend server is running on http://127.0.0.1:8000.`;
      }
    }
    throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail), resp.status);
  }
  return (await resp.json()) as T;
}
