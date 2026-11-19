import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import type { CrewItem, EquipmentItem, PlanItem, PlotItem } from '../types';
import {
  ActionStatusLine,
  EmptyState,
  InlineError,
  SkeletonCard,
  SkeletonTable,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

export const ReplanningPage: React.FC = () => {
  const { pushToast, refreshNotifications } = useApp();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [basePlan, setBasePlan] = useState<PlanItem | null>(null);
  const [versions, setVersions] = useState<PlanItem[]>([]);
  const [crews, setCrews] = useState<CrewItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [plots, setPlots] = useState<PlotItem[]>([]);
  const [replanResult, setReplanResult] = useState<any>(null);

  const [disruptionType, setDisruptionType] = useState<
    | 'early_rain'
    | 'crew_unavailable'
    | 'equipment_failure'
    | 'urgent_priority'
    | 'task_overrun'
    | 'weather_unavailable'
  >('early_rain');
  const [occursAtSlot, setOccursAtSlot] = useState<number>(16);
  const [rainStartH, setRainStartH] = useState<number>(5);
  const [rainEndH, setRainEndH] = useState<number>(10);
  const [rainIntensity, setRainIntensity] = useState<number>(4.2);
  const [targetCrewId, setTargetCrewId] = useState<number>(2);
  const [targetEqId, setTargetEqId] = useState<number>(1);
  const [targetPlotId, setTargetPlotId] = useState<number>(6);
  const [targetTaskKey, setTargetTaskKey] = useState<string>('');
  const [extraMinutes, setExtraMinutes] = useState<number>(60);
  const [running, setRunning] = useState<boolean>(false);
  const [replanDone, setReplanDone] = useState<boolean>(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [timedOut, setTimedOut] = useState<boolean>(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const loadContext = async (planId?: number) => {
    setLoading(true);
    setTimedOut(false);
    try {
      const [pList, cList, eList, plList] = await Promise.all([
        apiRequest<PlanItem[]>('/plans'),
        apiRequest<CrewItem[]>('/crews'),
        apiRequest<EquipmentItem[]>('/equipment'),
        apiRequest<PlotItem[]>('/plots'),
      ]);
      setPlans(pList);
      setCrews(cList);
      setEquipment(eList);
      setPlots(plList);
      if (cList[0]) setTargetCrewId(cList[1]?.id || cList[0].id);
      if (eList[0]) setTargetEqId(eList[0].id);
      if (plList[0]) setTargetPlotId(plList[5]?.id || plList[0].id);

      const activeId = planId || basePlan?.id || pList[0]?.id;
      if (activeId) {
        const detail = await apiRequest<PlanItem>(`/plans/${activeId}`);
        setBasePlan(detail);
        if (detail.assignments?.length && !targetTaskKey) {
          setTargetTaskKey(detail.assignments[0].task_key);
        }
        const vers = await apiRequest<PlanItem[]>(`/plans/${activeId}/versions`);
        setVersions(vers);
      }
    } catch (err: any) {
      pushToast('Load Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContext();
  }, []);

  const buildPayload = () => {
    if (disruptionType === 'early_rain') {
      return {
        start_hour: rainStartH,
        end_hour: rainEndH,
        intensity_mm: rainIntensity,
        probability: 0.9,
        seed: 7,
      };
    }
    if (disruptionType === 'crew_unavailable') {
      return {
        crew_id: targetCrewId,
        start_slot: occursAtSlot,
        end_slot: 144,
        reason: 'Unexpected field crew unavailability',
      };
    }
    if (disruptionType === 'equipment_failure') {
      return {
        equipment_id: targetEqId,
        from_slot: occursAtSlot,
      };
    }
    if (disruptionType === 'urgent_priority') {
      return {
        plot_id: targetPlotId,
      };
    }
    if (disruptionType === 'task_overrun') {
      return {
        task_key: targetTaskKey || basePlan?.assignments?.[0]?.task_key,
        extra_minutes: extraMinutes,
      };
    }
    return { attempt_refresh: false };
  };

  const handleTriggerReplan = async () => {
    if (!basePlan) return;
    setRunning(true);
    setReplanDone(false);
    setReplanError(null);
    try {
      const payload = buildPayload();
      const res = await apiRequest(`/plans/${basePlan.id}/replan`, {
        method: 'POST',
        body: JSON.stringify({
          disruption_type: disruptionType,
          occurs_at_slot: occursAtSlot,
          payload,
          description: `Disruption (${disruptionType}) triggered at slot ${occursAtSlot}`,
          time_limit_s: 6.0,
        }),
      });
      setReplanResult(res);
      setBasePlan(res.new_plan);
      await loadContext(res.new_plan.id);
      await refreshNotifications();
      setReplanDone(true);
      setTimeout(() => setReplanDone(false), 2500);
      pushToast(
        'Dynamic Replanning Complete',
        `Saved Plan #${res.new_plan.id} (v${res.new_plan.version}). Completed tasks frozen; remaining schedule validated.`,
        'success',
      );
    } catch (err: any) {
      setReplanError(err.message || 'Replanning failed');
      pushToast('Replanning Failed', err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const diffList: any[] = replanResult?.diff || basePlan?.diff || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-mono uppercase px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200">
            Freeze Completed Work → Apply Disruption → Re-Optimize → Validate → Version Diff
          </span>
          <h1 className="text-2xl font-bold text-[#17211C] mt-2">
            Dynamic Replanning & Disruption Engine
          </h1>
          <p className="text-xs text-stone-600 mt-1">
            Simulate real-world monsoon disruptions. Tasks finished or in-progress before the
            disruption timestamp are strictly frozen; remaining tasks are re-optimized and
            independently validated.
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-stone-500 mb-1">
            Base Plan to Replan From
          </label>
          <select
            value={basePlan?.id || ''}
            onChange={(e) => loadContext(Number(e.target.value))}
            className="px-3.5 py-2 rounded-xl border border-stone-300 text-xs bg-white font-semibold"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                Plan #{p.id} (v{p.version}) — {p.name} [{p.status.toUpperCase()}]
              </option>
            ))}
          </select>
        </div>
      </div>

      {!basePlan && (
        timedOut ? (
          <InlineError
            target="base plan for replanning"
            message="Request timed out after 20s. Could not load base plan."
            onRetry={() => loadContext()}
          />
        ) : loading || showSkeleton ? (
          <div aria-busy="true" className="space-y-6">
            <div className="grid lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7"><SkeletonCard height={300} /></div>
              <div className="lg:col-span-5"><SkeletonCard height={300} /></div>
            </div>
            <SkeletonTable rows={5} cols={6} />
          </div>
        ) : (
          <EmptyState
            message="No baseline schedule found. Generate a plan first."
            to="/planner"
            actionLabel="Go to Planner"
          />
        )
      )}

      {basePlan && (
        <>
          {/* Disruption Selector + Parameters */}
          <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            1. Select Operational Disruption Event
          </h2>

          <div className="grid sm:grid-cols-3 gap-2.5 text-xs">
            {[
              {
                id: 'early_rain',
                label: '1. Early Rainfall Arrival',
                desc: 'Squall narrows dry window',
              },
              {
                id: 'crew_unavailable',
                label: '2. Crew Unavailable',
                desc: 'Crew off-duty from slot',
              },
              {
                id: 'equipment_failure',
                label: '3. Equipment Failure',
                desc: 'Sprayer rig breakdown',
              },
              {
                id: 'urgent_priority',
                label: '4. Urgent Plot Escalation',
                desc: 'Plot raised to URGENT (2.0x)',
              },
              {
                id: 'task_overrun',
                label: '5. Task Duration Overrun',
                desc: 'In-progress task takes longer',
              },
              {
                id: 'weather_unavailable',
                label: '6. Weather Data Stale',
                desc: 'Raises min dry prob +15%',
              },
            ].map((item) => {
              const active = disruptionType === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDisruptionType(item.id as any)}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    active
                      ? 'bg-[#0C1F17] text-white border-emerald-600'
                      : 'bg-stone-50 hover:bg-stone-100 border-stone-200 text-[#17211C]'
                  }`}
                >
                  <div className="font-bold">{item.label}</div>
                  <div className={`text-[10px] mt-0.5 ${active ? 'text-emerald-200' : 'text-stone-500'}`}>
                    {item.desc}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Disruption Timestamp & Specific Controls */}
          <div className="pt-3 border-t border-stone-200 space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-stone-700">
                Disruption Timestamp Slot: Slot {occursAtSlot} (+{(occursAtSlot / 4).toFixed(1)}h
                into horizon — tasks ending ≤ slot {occursAtSlot} are frozen as COMPLETED)
              </label>
              <input
                type="range"
                min={4}
                max={64}
                step={2}
                value={occursAtSlot}
                onChange={(e) => setOccursAtSlot(Number(e.target.value))}
                className="w-full mt-1.5 accent-[#0C1F17]"
              />
            </div>

            {disruptionType === 'early_rain' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                <div>
                  <label className="block font-semibold text-stone-600">
                    Squall Start Hour (+h)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={rainStartH}
                    onChange={(e) => setRainStartH(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white mt-1"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-600">Squall End Hour (+h)</label>
                  <input
                    type="number"
                    min={1}
                    max={70}
                    value={rainEndH}
                    onChange={(e) => setRainEndH(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white mt-1"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-600">Intensity (mm/h)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={rainIntensity}
                    onChange={(e) => setRainIntensity(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded border border-stone-300 bg-white mt-1"
                  />
                </div>
              </div>
            )}

            {disruptionType === 'crew_unavailable' && (
              <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                <label className="block font-semibold text-stone-600 mb-1">
                  Select Crew Becoming Unavailable
                </label>
                <select
                  value={targetCrewId}
                  onChange={(e) => setTargetCrewId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded border border-stone-300 bg-white"
                >
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {disruptionType === 'equipment_failure' && (
              <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                <label className="block font-semibold text-stone-600 mb-1">
                  Select Equipment Failing at Slot {occursAtSlot}
                </label>
                <select
                  value={targetEqId}
                  onChange={(e) => setTargetEqId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded border border-stone-300 bg-white"
                >
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.code} — {eq.name} ({eq.type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {disruptionType === 'urgent_priority' && (
              <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                <label className="block font-semibold text-stone-600 mb-1">
                  Select Plot Escalated to URGENT
                </label>
                <select
                  value={targetPlotId}
                  onChange={(e) => setTargetPlotId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded border border-stone-300 bg-white"
                >
                  {plots.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.code} — {pl.name} (current: {pl.priority})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {disruptionType === 'task_overrun' && (
              <div className="grid sm:grid-cols-2 gap-3 bg-stone-50 p-3.5 rounded-xl border border-stone-200">
                <div>
                  <label className="block font-semibold text-stone-600 mb-1">Task Key</label>
                  <select
                    value={targetTaskKey}
                    onChange={(e) => setTargetTaskKey(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-stone-300 bg-white"
                  >
                    {(basePlan?.assignments || []).map((a) => (
                      <option key={a.task_key} value={a.task_key}>
                        {a.task_key} ({a.plot_code} on {a.crew_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-stone-600 mb-1">
                    Extra Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    step={15}
                    value={extraMinutes}
                    onChange={(e) => setExtraMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded border border-stone-300 bg-white"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={handleTriggerReplan}
                disabled={running || !basePlan}
                className="w-full py-3 rounded-xl bg-[#0C1F17] hover:bg-emerald-950 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {running
                  ? 'Freezing Completed Work & Re-Optimizing...'
                  : `Trigger ${disruptionType.toUpperCase()} & Replan From Plan #${basePlan?.id}`}
              </button>
              <ActionStatusLine
                isRunning={running}
                actionName="Replanning"
                timeLimit={6}
                isDone={replanDone}
                error={replanError}
                onRetry={handleTriggerReplan}
              />
            </div>
          </div>
        </div>

        {/* Right Plan Version History */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            Plan Lineage & Version History ({versions.length} Versions)
          </h2>

          <div className="space-y-3 max-h-[380px] overflow-y-auto">
            {versions.map((v) => (
              <div
                key={v.id}
                onClick={() => setBasePlan(v)}
                className={`p-3.5 rounded-xl border text-xs transition cursor-pointer ${
                  basePlan?.id === v.id
                    ? 'bg-emerald-50/80 border-emerald-600'
                    : 'bg-stone-50 border-stone-200 hover:bg-stone-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#17211C]">
                    Version v{v.version} · Plan #{v.id}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#0C1F17] text-white font-mono text-[10px]">
                    {v.solver?.status}
                  </span>
                </div>
                <div className="text-stone-700 font-medium mt-1">{v.name}</div>
                <div className="text-[11px] text-stone-500 mt-1 flex items-center justify-between">
                  <span>Now Slot: {v.now_slot}</span>
                  <span>
                    Valid: <strong>{v.validation?.valid ? 'YES' : 'NO'}</strong> · Assigned:{' '}
                    {v.assignments?.length || 0}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Previous vs Revised Schedule Diff Table */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
              Schedule Replanning Diff & Assignment Change Explanations
            </h2>
            <p className="text-xs text-stone-500">
              Shows frozen tasks, rescheduled slots, crew reassignments, and exact reasons for each
              change.
            </p>
          </div>
          {basePlan && (
            <span className="text-xs font-mono px-3 py-1 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-200">
              Inspecting Plan #{basePlan.id} (v{basePlan.version})
            </span>
          )}
        </div>

        {diffList.length === 0 ? (
          <div className="p-8 text-center text-xs text-stone-500 bg-stone-50 rounded-xl">
            Trigger a disruption event above to generate a versioned schedule comparison.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 uppercase text-[10px]">
                  <th className="py-2.5 pr-3">Plot / Task</th>
                  <th className="py-2.5 pr-3">Change Type</th>
                  <th className="py-2.5 pr-3">Previous Assignment</th>
                  <th className="py-2.5 pr-3">Revised Assignment</th>
                  <th className="py-2.5">Reason for Change / Immutability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {diffList.map((d: any) => (
                  <tr key={d.task_key} className="hover:bg-stone-50">
                    <td className="py-3 pr-3 font-mono font-bold text-[#17211C]">
                      {d.plot_code} ({d.task_key})
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                          d.change.startsWith('frozen')
                            ? 'bg-stone-200 text-stone-900'
                            : d.change === 'unchanged'
                            ? 'bg-emerald-50 text-emerald-800'
                            : d.change === 'newly_unscheduled'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {d.change}
                      </span>
                    </td>
                    <td className="py-3 pr-3 font-mono text-stone-600">
                      {d.previous
                        ? `${d.previous.crew_code || d.previous.crew_id} · Slots ${d.previous.start_slot}–${d.previous.end_slot}`
                        : 'Unscheduled'}
                    </td>
                    <td className="py-3 pr-3 font-mono font-semibold text-[#17211C]">
                      {d.new
                        ? `${d.new.crew_code || d.new.crew_id} · Slots ${d.new.start_slot}–${d.new.end_slot}`
                        : 'Unscheduled'}
                    </td>
                    <td className="py-3 text-stone-700">{(d.reasons || []).join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )}
</div>
);
};
