import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { apiRequest, cacheApprovedPlan } from '../services/api';
import type { AssignmentItem, CrewItem, PlanItem } from '../types';
import {
  EmptyState,
  InlineError,
  SkeletonBlock,
  SkeletonCard,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

export const CrewGanttPage: React.FC = () => {
  const { pushToast, refreshNotifications } = useApp();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [crews, setCrews] = useState<CrewItem[]>([]);
  const [plan, setPlan] = useState<PlanItem | null>(null);
  const [comparePlan, setComparePlan] = useState<PlanItem | null>(null);
  const [crewFilter, setCrewFilter] = useState<string>('');
  const [plotFilter, setPlotFilter] = useState<string>('');
  const [selectedAsg, setSelectedAsg] = useState<AssignmentItem | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [timedOut, setTimedOut] = useState<boolean>(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const loadData = async (planId?: number) => {
    setLoading(true);
    setTimedOut(false);
    try {
      const [pList, cList] = await Promise.all([
        apiRequest<PlanItem[]>('/plans'),
        apiRequest<CrewItem[]>('/crews'),
      ]);
      setPlans(pList);
      setCrews(cList);
      const targetId = planId || plan?.id || pList[0]?.id;
      if (targetId) {
        const detail = await apiRequest<PlanItem>(`/plans/${targetId}`);
        setPlan(detail);
        if (detail.assignments?.length && !selectedAsg) {
          setSelectedAsg(detail.assignments[0]);
        }
        if (detail.parent_plan_id) {
          const parentDetail = await apiRequest<PlanItem>(`/plans/${detail.parent_plan_id}`);
          setComparePlan(parentDetail);
        } else {
          setComparePlan(null);
        }
      }
    } catch (err: any) {
      pushToast('Gantt Load Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApprove = async () => {
    if (!plan) return;
    try {
      const approved = await apiRequest<PlanItem>(`/plans/${plan.id}/approve`, { method: 'POST' });
      setPlan(approved);
      cacheApprovedPlan(approved);
      await loadData(approved.id);
      await refreshNotifications();
      pushToast('Schedule Approved', `Plan #${approved.id} published to crews & farmers.`, 'success');
    } catch (err: any) {
      pushToast('Approve Failed', err.message, 'error');
    }
  };

  if (!plan) {
    if (timedOut || (!loading && !plan && plans.length === 0)) {
      return (
        <div className="p-6">
          <EmptyState
            message="No operations scheduled yet."
            to="/planner"
            actionLabel="Generate Plan with CP-SAT Optimizer"
          />
        </div>
      );
    }

    if (loading || showSkeleton) {
      return (
        <div aria-busy="true" className="space-y-6">
          <SkeletonCard height={120} />
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <SkeletonBlock height={18} width={200} />
              <SkeletonBlock height={14} width={120} />
            </div>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4 py-3 border-b border-stone-100 last:border-b-0">
                <SkeletonBlock height={20} width={100} />
                <div className="flex-1 flex gap-2">
                  <SkeletonBlock height={32} width="35%" radius={6} />
                  <SkeletonBlock height={32} width="45%" radius={6} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="p-6">
        <InlineError
          target="crew gantt schedule"
          onRetry={() => loadData()}
        />
      </div>
    );
  }

  const totalSlots = (plan?.horizon_hours || 72) * 4;
  const assignments = (plan?.assignments || []).filter((a) => {
    if (crewFilter && a.crew_code !== crewFilter) return false;
    if (plotFilter && a.plot_code !== plotFilter) return false;
    return true;
  });

  const visibleCrews = crews.filter((c) => !crewFilter || c.code === crewFilter);
  const allPlotCodes = Array.from(new Set((plan?.assignments || []).map((a) => a.plot_code))).sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200">
              Plan #{plan?.id} · v{plan?.version} · {plan?.status.toUpperCase()}
            </span>
            <span className="text-xs text-stone-500 font-mono">
              Solver: {plan?.solver?.status} · 15-min slot resolution ({totalSlots} slots /{' '}
              {plan?.horizon_hours}h)
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[#17211C] mt-2">
            Crew Gantt Scheduler & Version Inspector
          </h1>
          <p className="text-xs text-stone-600 mt-1">
            Displays crew rows, plot task bars, preceding travel buffers, frozen completed tasks,
            and version-to-version schedule comparisons.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={plan?.id || ''}
            onChange={(e) => loadData(Number(e.target.value))}
            className="px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white font-semibold"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                Plan #{p.id} (v{p.version}) — {p.name} [{p.status.toUpperCase()}]
              </option>
            ))}
          </select>

          {plan && plan.status !== 'approved' && (
            <button
              onClick={handleApprove}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            > Approve Plan #{plan.id}
            </button>
          )}
        </div>
      </div>

      {/* Filters & Legend */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-stone-700 flex items-center gap-1"> Filter:
          </span>
          <select
            value={crewFilter}
            onChange={(e) => setCrewFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white"
          >
            <option value="">All Crews ({crews.length})</option>
            {crews.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>

          <select
            value={plotFilter}
            onChange={(e) => setPlotFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white"
          >
            <option value="">All Plots ({allPlotCodes.length})</option>
            {allPlotCodes.map((code) => (
              <option key={code} value={code}>
                Plot {code}
              </option>
            ))}
          </select>

          <select
            value={comparePlan?.id || ''}
            onChange={async (e) => {
              const id = Number(e.target.value);
              if (!id) {
                setComparePlan(null);
              } else {
                const d = await apiRequest<PlanItem>(`/plans/${id}`);
                setComparePlan(d);
              }
            }}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white"
          >
            <option value="">No Ghost Comparison Overlay</option>
            {plans
              .filter((p) => p.id !== plan?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  Compare vs Plan #{p.id} (v{p.version})
                </option>
              ))}
          </select>
        </div>

        {/* Gantt Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-700 inline-block" /> Protection (PROT)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-blue-600 inline-block" /> Inspection (INSP)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Travel Buffer
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-stone-600 inline-block" /> Frozen Completed Work
          </span>
        </div>
      </div>

      {/* Interactive Gantt Timeline Board */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-x-auto">
        <div className="min-w-[980px] p-5">
          {/* Hour ruler header */}
          <div className="flex border-b border-stone-200 pb-2 text-[10px] font-mono text-stone-500">
            <div className="w-52 shrink-0 font-bold uppercase text-stone-700">
              Crew / Shift Capacity
            </div>
            <div className="flex-1 relative h-5">
              {[0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72].map((h) => (
                <span
                  key={h}
                  style={{ left: `${(h / 72) * 100}%` }}
                  className="absolute -translate-x-1/2"
                >
                  +{h}h
                </span>
              ))}
            </div>
          </div>

          {/* Crew Rows */}
          <div className="divide-y divide-stone-100">
            {visibleCrews.map((crew) => {
              const crewAsgs = assignments.filter((a) => a.crew_id === crew.id);
              const ghostAsgs = (comparePlan?.assignments || []).filter(
                (a) => a.crew_id === crew.id,
              );
              return (
                <div key={crew.id} className="flex items-center py-4">
                  <div className="w-52 shrink-0 pr-3">
                    <div className="text-xs font-bold text-[#17211C]">
                      {crew.code} — {crew.name}
                    </div>
                    <div className="text-[11px] text-stone-500">
                      Shift {crew.shift_start_hour}:00–{crew.shift_end_hour}:00 ·{' '}
                      {crewAsgs.length} tasks
                    </div>
                  </div>

                  <div className="flex-1 relative h-14 bg-stone-50 rounded-xl border border-stone-200/80 overflow-hidden">
                    {/* Day dividers */}
                    {[24, 48].map((h) => (
                      <div
                        key={h}
                        style={{ left: `${(h / 72) * 100}%` }}
                        className="absolute inset-y-0 border-l border-dashed border-stone-300"
                      />
                    ))}

                    {/* Ghost overlay from compared plan */}
                    {ghostAsgs.map((ga) => {
                      const left = (ga.start_slot / totalSlots) * 100;
                      const width = Math.max(1.2, ((ga.end_slot - ga.start_slot) / totalSlots) * 100);
                      return (
                        <div
                          key={`ghost-${ga.id}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`Compared Plan #${comparePlan?.id}: ${ga.plot_code} (${ga.task_code}) slots ${ga.start_slot}-${ga.end_slot}`}
                          className="absolute top-1 h-3 rounded bg-stone-400/40 border border-dashed border-stone-500 text-[8px] px-1 truncate text-stone-700"
                        >
                          v{comparePlan?.version}:{ga.plot_code}
                        </div>
                      );
                    })}

                    {/* Actual Travel Buffers & Task Bars */}
                    {crewAsgs.map((a) => {
                      const taskLeft = (a.start_slot / totalSlots) * 100;
                      const taskWidth = Math.max(
                        1.8,
                        ((a.end_slot - a.start_slot) / totalSlots) * 100,
                      );
                      const travelLeft =
                        (Math.max(0, a.start_slot - a.travel_slots) / totalSlots) * 100;
                      const travelWidth = (a.travel_slots / totalSlots) * 100;

                      const isSelected = selectedAsg?.id === a.id;
                      const barColor = a.frozen
                        ? 'bg-stone-700 border-stone-900 text-white'
                        : a.task_code === 'INSP'
                        ? 'bg-blue-600 border-blue-800 text-white'
                        : 'bg-emerald-700 border-emerald-950 text-white';

                      return (
                        <React.Fragment key={a.id}>
                          {a.travel_slots > 0 && (
                            <div
                              style={{ left: `${travelLeft}%`, width: `${travelWidth}%` }}
                              title={`Travel buffer: ${a.travel_minutes} min before ${a.plot_code}`}
                              className="absolute top-5 h-7 bg-amber-400/80 border-y border-l border-amber-600 rounded-l"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedAsg(a)}
                            style={{ left: `${taskLeft}%`, width: `${taskWidth}%` }}
                            className={`absolute top-4 h-9 rounded-md border px-1.5 flex items-center justify-between text-[10px] font-bold shadow-xs transition cursor-pointer ${barColor} ${
                              isSelected ? 'ring-2 ring-amber-400 z-20' : 'z-10'
                            }`}
                          >
                            <span className="truncate">
                              {a.frozen ? '🔒 ' : ''}
                              {a.plot_code} ({a.task_code})
                            </span>
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected Assignment Inspector & Unassigned Tasks */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2 mb-3">
            Selected Gantt Task Inspector
          </h2>
          {selectedAsg ? (
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200">
                <div>
                  <span className="font-mono font-bold text-sm text-[#17211C]">
                    {selectedAsg.plot_code} — {selectedAsg.plot_name} ({selectedAsg.task_code})
                  </span>
                  <div className="text-stone-600 mt-0.5">
                    Assigned Crew: <strong>{selectedAsg.crew_code}</strong> ({selectedAsg.crew_name})
                    · Equipment: <code>{selectedAsg.equipment_type || 'none'}</code>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="font-bold text-emerald-900">
                    Slots {selectedAsg.start_slot}–{selectedAsg.end_slot} (
                    {selectedAsg.duration_minutes} min)
                  </div>
                  <div className="text-stone-500 flex items-center justify-end gap-1"> Travel buffer:{' '}
                    {selectedAsg.travel_minutes} min
                  </div>
                </div>
              </div>

              {selectedAsg.frozen && (
                <div className="p-2.5 rounded-lg bg-stone-100 border border-stone-300 text-stone-800 flex items-center gap-2 font-semibold"> Frozen Task ({selectedAsg.status}):
                  Completed or in-progress work is immutable during replanning.
                </div>
              )}

              <div className="space-y-1 text-stone-700">
                {(selectedAsg.explanation?.factors || []).map((f, i) => (
                  <div key={i}>• {f}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-stone-500">Click any task bar in the Gantt chart above.</div>
          )}
        </div>

        {/* Unassigned Tasks & Plan Version Diff Summary */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-3">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            Unassigned Tasks & Schedule Conflicts ({plan?.unscheduled?.length || 0})
          </h2>
          {plan?.unscheduled && plan.unscheduled.length > 0 ? (
            <div className="space-y-2 max-h-56 overflow-y-auto text-xs">
              {plan.unscheduled.map((u) => (
                <div
                  key={u.task_key}
                  className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950"
                >
                  <div className="font-bold flex items-center gap-1.5">
                    {u.plot_code} ({u.task_key})
                  </div>
                  <div className="text-[11px] mt-1">{u.reasons.join(' · ')}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-medium">
              All active plot operations are assigned in Plan #{plan?.id} with zero constraint
              violations.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
