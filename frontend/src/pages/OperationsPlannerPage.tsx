import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Play,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest, cacheApprovedPlan } from '../services/api';
import type { PlanItem } from '../types';
import {
  ActionStatusLine,
  EmptyState,
  InlineError,
  SkeletonCard,
  SkeletonTable,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

export const OperationsPlannerPage: React.FC = () => {
  const { pushToast, refreshNotifications } = useApp();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null);
  const [sensitivity, setSensitivity] = useState<'low' | 'base' | 'high'>('base');
  const [policy, setPolicy] = useState<'optimized' | 'reactive' | 'calendar'>('optimized');
  const [timeLimit, setTimeLimit] = useState<number>(8.0);
  const [planName, setPlanName] = useState<string>('');
  const [solving, setSolving] = useState<boolean>(false);
  const [optDone, setOptDone] = useState<boolean>(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [timedOut, setTimedOut] = useState<boolean>(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const loadPlans = async (selectId?: number) => {
    setLoading(true);
    setTimedOut(false);
    try {
      const list = await apiRequest<PlanItem[]>('/plans');
      setPlans(list);
      const targetId = selectId || selectedPlan?.id || list[0]?.id;
      if (targetId) {
        const detail = await apiRequest<PlanItem>(`/plans/${targetId}`);
        setSelectedPlan(detail);
      }
    } catch (err: any) {
      pushToast('Load Plans Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const handleOptimize = async () => {
    setSolving(true);
    setOptDone(false);
    setOptError(null);
    try {
      const created = await apiRequest<PlanItem>('/plans/optimize', {
        method: 'POST',
        body: JSON.stringify({
          name: planName || undefined,
          sensitivity,
          policy,
          time_limit_s: timeLimit,
          seed: 42,
        }),
      });
      setSelectedPlan(created);
      await loadPlans(created.id);
      await refreshNotifications();
      setOptDone(true);
      setTimeout(() => setOptDone(false), 2500);
      pushToast(
        'CP-SAT Optimization Complete',
        `Plan #${created.id} solved (${created.solver.status}) in ${created.solver.solve_time_s}s · Objective ${created.solver.objective}`,
        'success',
      );
    } catch (err: any) {
      setOptError(err.message || 'Optimizer failed');
      pushToast('Optimizer Error', err.message, 'error');
    } finally {
      setSolving(false);
    }
  };

  const handleApprove = async (planId: number) => {
    try {
      const approved = await apiRequest<PlanItem>(`/plans/${planId}/approve`, { method: 'POST' });
      setSelectedPlan(approved);
      cacheApprovedPlan(approved);
      await loadPlans(approved.id);
      await refreshNotifications();
      pushToast('Plan Approved & Published', `Plan #${approved.id} is now active.`, 'success');
    } catch (err: any) {
      pushToast('Approval Error', err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Optimizer Controls Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200">
              Google OR-Tools CP-SAT Engine
            </span>
            <h1 className="text-2xl font-bold text-[#17211C] mt-2">
              Mathematical Operations Planner
            </h1>
            <p className="text-xs text-stone-600 mt-1">
              Minimizes expected weighted simulated exposure across rainfall scenarios subject to 9
              hard operational constraints and independent first-principles plan validation.
            </p>
          </div>
          <Link
            to="/gantt"
            className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-bold text-[#17211C] flex items-center gap-1.5 self-start"
          >
            Open Interactive Gantt <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-stone-100 text-xs">
          <div>
            <label className="block font-semibold text-stone-600 mb-1">Schedule Name</label>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="Optional custom name..."
              className="w-full px-3 py-2 rounded-lg border border-stone-300"
            />
          </div>
          <div>
            <label className="block font-semibold text-stone-600 mb-1">Scheduling Policy</label>
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white"
            >
              <option value="optimized">MahaliShield Optimized (CP-SAT)</option>
              <option value="reactive">Reactive First-Window Baseline</option>
              <option value="calendar">Calendar Route Baseline</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-stone-600 mb-1">Twin Sensitivity</label>
            <select
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white"
            >
              <option value="low">Low Sensitivity</option>
              <option value="base">Base Sensitivity</option>
              <option value="high">High Sensitivity</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-stone-600 mb-1">
              Solver Time Limit: {timeLimit}s
            </label>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={timeLimit}
              onChange={(e) => setTimeLimit(Number(e.target.value))}
              className="w-full mt-2 accent-emerald-700"
            />
          </div>
          <div className="flex flex-col justify-end gap-1.5">
            <button
              onClick={handleOptimize}
              disabled={solving}
              className="w-full py-2.5 px-4 rounded-xl bg-[#0C1F17] hover:bg-emerald-950 text-white font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-current" />
              {solving ? 'Solving CP-SAT...' : 'Solve & Validate Plan'}
            </button>
            <ActionStatusLine
              isRunning={solving}
              actionName="Optimizing"
              timeLimit={timeLimit}
              isDone={optDone}
              error={optError}
              onRetry={handleOptimize}
              className="mt-1"
            />
          </div>
        </div>
      </div>

      {!selectedPlan && (
        timedOut ? (
          <InlineError
            target="operations plans"
            message="Request timed out after 20s. Could not load optimizer plans."
            onRetry={() => loadPlans()}
          />
        ) : loading || showSkeleton ? (
          <div aria-busy="true" className="space-y-6">
            <div className="grid lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6"><SkeletonCard height={240} /></div>
              <div className="lg:col-span-6"><SkeletonCard height={240} /></div>
            </div>
            <SkeletonTable rows={5} cols={6} />
          </div>
        ) : (
          <EmptyState
            message="No operations scheduled yet."
            actionLabel="Run CP-SAT Optimizer"
            onAction={handleOptimize}
          />
        )
      )}

      {selectedPlan && (
        <>
          {/* Solver Telemetry + Independent Validator Cards */}
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-[#0C1F17] text-white rounded-2xl p-6 border border-emerald-900 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-mono uppercase text-emerald-300">
                    Solver Telemetry · Plan #{selectedPlan.id} (v{selectedPlan.version})
                  </span>
                  <h2 className="text-lg font-bold mt-0.5">{selectedPlan.name}</h2>
                </div>
                {selectedPlan.status !== 'approved' ? (
                  <button
                    onClick={() => handleApprove(selectedPlan.id)}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0C1F17] text-xs font-bold cursor-pointer"
                  >
                    Approve & Publish Plan
                  </button>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-emerald-800 text-emerald-200 text-xs font-bold uppercase">
                    APPROVED
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800">
                  <div className="text-emerald-300/80 text-[10px] uppercase">Solver Status</div>
                  <div className="text-sm font-bold font-mono mt-1">
                    {selectedPlan.solver?.status || 'HEURISTIC'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800">
                  <div className="text-emerald-300/80 text-[10px] uppercase">Objective Value</div>
                  <div className="text-sm font-bold font-mono mt-1">
                    {selectedPlan.solver?.objective ??
                      selectedPlan.metrics?.expected_weighted_exposure ??
                      '-'}
                  </div>
                </div>
              </div>

              <details className="text-xs rounded-xl bg-emerald-950/40 border border-emerald-800/60 p-2.5">
                <summary className="cursor-pointer font-semibold text-emerald-300 hover:text-emerald-200 select-none">
                  Technical solver details
                </summary>
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-emerald-900/60 text-xs">
                  <div>
                    <span className="text-emerald-400/80 text-[10px] uppercase block">Solve Wall Time</span>
                    <span className="font-mono font-bold text-white">
                      {selectedPlan.solver?.solve_time_s ?? 0.01}s
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-400/80 text-[10px] uppercase block">Variables / Constraints</span>
                    <span className="font-mono font-bold text-white">
                      {selectedPlan.solver?.variables || '-'} / {selectedPlan.solver?.constraints || '-'}
                    </span>
                  </div>
                </div>
              </details>

              <div className="text-xs text-emerald-200/90 bg-emerald-900/40 p-3 rounded-xl border border-emerald-800">
                <strong>Optimality Claim Honesty:</strong>{' '}
                {selectedPlan.solver?.optimality_claim ||
                  'Heuristic baseline schedule (not proven optimal).'}
                {selectedPlan.solver?.fallback_used && (
                  <span className="ml-2 text-amber-300 font-bold">
                    (Greedy fallback used after timeout/infeasibility)
                  </span>
                )}
              </div>
            </div>

            {/* Independent Validator Report */}
            <div className="lg:col-span-6 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    Independent First-Principles Constraint Validator
                  </h2>
                  <p className="text-xs text-stone-500">
                    Every schedule is independently verified against all 11 hard constraint checks.
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                    selectedPlan.validation?.valid
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {selectedPlan.validation?.valid ? 'ALL CHECKS PASSED' : 'VIOLATIONS DETECTED'}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-xs">
                {(selectedPlan.validation?.checks || []).map((chk) => (
                  <div
                    key={chk.check}
                    className={`p-2.5 rounded-lg border flex items-center justify-between ${
                      chk.passed
                        ? 'bg-stone-50 border-stone-200 text-stone-800'
                        : 'bg-red-50 border-red-300 text-red-900'
                    }`}
                  >
                    <span className="font-mono text-[11px]">{chk.check}</span>
                    {chk.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Unscheduled / Infeasible Tasks Diagnostic */}
          {selectedPlan.unscheduled && selectedPlan.unscheduled.length > 0 && (
            <div className="bg-amber-50 rounded-2xl border border-amber-300 p-5 space-y-2">
              <div className="text-xs font-bold uppercase text-amber-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                Unscheduled Tasks & Infeasibility Explanations ({selectedPlan.unscheduled.length})
              </div>
              <div className="grid md:grid-cols-2 gap-3 text-xs">
                {selectedPlan.unscheduled.map((u) => (
                  <div
                    key={u.task_key}
                    className="p-3 rounded-xl bg-white border border-amber-200 text-stone-800"
                  >
                    <div className="font-bold">
                      {u.plot_code} ({u.task_key}) — Unprotected Weighted Exposure:{' '}
                      {u.exposure_if_unprotected}
                    </div>
                    <ul className="list-disc pl-4 mt-1 text-stone-600">
                      {u.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Computed Assignments Table with Explainability */}
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
                <Cpu className="w-4 h-4 text-emerald-700" />
                Computed Assignments & Explainable Reasoning ({selectedPlan.assignments?.length || 0}{' '}
                Tasks)
              </h2>
              <select
                value={selectedPlan.id}
                onChange={(e) => loadPlans(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs bg-white"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    Plan #{p.id} (v{p.version}) — {p.name} [{p.status.toUpperCase()}]
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              {(selectedPlan.assignments || []).map((a) => (
                <div
                  key={a.id}
                  className="p-4 rounded-xl border border-stone-200 bg-stone-50/60 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#0C1F17] text-white font-mono font-bold">
                        {a.task_code}
                      </span>
                      <span className="font-bold text-sm text-[#17211C]">
                        {a.plot_code} — {a.plot_name} ({a.plot_area_acres} ac ·{' '}
                        <span className="uppercase">{a.plot_priority}</span>)
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono">
                      <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-950 font-bold">
                        Crew: {a.crew_code} ({a.crew_name})
                      </span>
                      <span className="text-stone-700">
                        Slots {a.start_slot}–{a.end_slot} ({a.duration_minutes}m + {a.travel_minutes}
                        m travel)
                      </span>
                    </div>
                  </div>
                  <div className="text-stone-600">
                    Window: <strong>{new Date(a.start_time).toLocaleString()}</strong> to{' '}
                    <strong>{new Date(a.end_time).toLocaleString()}</strong> · Dry-Window
                    Probability: <strong>{((a.window_probability || 0) * 100).toFixed(0)}%</strong>
                    {a.expected_exposure != null && (
                      <span>
                        {' '}
                        · Expected Weighted Exposure: <strong>{a.expected_exposure}</strong> (down
                        from <strong>{a.exposure_if_unprotected}</strong> unprotected)
                      </span>
                    )}
                  </div>
                  {a.explanation?.factors && (
                    <div className="pl-3 border-l-2 border-emerald-600 text-[11px] text-stone-700 space-y-0.5">
                      {a.explanation.factors.map((f, i) => (
                        <div key={i}>• {f}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
