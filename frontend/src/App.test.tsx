import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { t } from './utils/i18n';
import {
  cacheApprovedPlan,
  getCachedApprovedPlan,
  setAuthSession,
  getStoredUser,
  clearAuthSession,
} from './services/api';
import { App } from './App';

describe('MahaliShield Frontend Core Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('supports bilingual English and Kannada translations', () => {
    expect(t('en', 'tagline')).toBe('Win the gaps between the rains.');
    expect(t('kn', 'tagline')).toContain('ಮಳೆಯ');
    expect(t('en', 'nav_arena')).toBe('Policy Arena');
  });

  it('persists and retrieves offline approved plan cache and auth session', () => {
    setAuthSession('demo-jwt', {
      id: 1,
      email: 'coordinator@mahalishield.org',
      full_name: 'Kaveri Hegde',
      role: 'coordinator',
      is_active: true,
      language: 'en',
      preferences: {},
    });
    expect(getStoredUser()?.email).toBe('coordinator@mahalishield.org');

    cacheApprovedPlan({
      id: 10,
      name: 'Test Approved Schedule',
      lineage_id: 10,
      version: 1,
      status: 'approved',
      policy: 'optimized',
      scenario_set_id: 1,
      parameter_set_id: 1,
      horizon_start: '2026-07-15T00:00:00Z',
      horizon_hours: 72,
      now_slot: 0,
      context: {},
      solver: { status: 'OPTIMAL', objective: 210.5 },
      validation: { valid: true, assignment_count: 8, checks: [] },
      unscheduled: [],
      metrics: {},
      created_at: '2026-07-15T00:00:00Z',
    });

    const cached = getCachedApprovedPlan();
    expect(cached?.plan.name).toBe('Test Approved Schedule');
    expect(cached?.plan.solver.status).toBe('OPTIMAL');

    clearAuthSession();
    expect(getStoredUser()).toBeNull();
  });

  it('renders Authentication screen when unauthenticated', () => {
    render(<App />);
    expect(screen.getByText(/Win the gaps between the rains/i)).toBeTruthy();
    expect(screen.getAllByText(/Cooperative Coordinator/i).length).toBeGreaterThan(0);
  });
});
