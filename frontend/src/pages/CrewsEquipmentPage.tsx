import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import type { CrewItem, EquipmentItem, TaskRuleItem } from '../types';
import {
  EmptyState,
  InlineError,
  SkeletonBlock,
  SkeletonCard,
  SkeletonTable,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

export const CrewsEquipmentPage: React.FC = () => {
  const { pushToast } = useApp();
  const [crews, setCrews] = useState<CrewItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [rules, setRules] = useState<TaskRuleItem[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const [newCrew, setNewCrew] = useState({
    code: 'C-05',
    name: '',
    leader: '',
    size: 3,
    shift_start_hour: 7,
    shift_end_hour: 18,
    max_hours_per_day: 8.0,
    eligibility: ['INSP', 'PROT'],
  });
  const [newEq, setNewEq] = useState({
    code: 'EQ-05',
    type: 'sprayer_unit',
    name: '',
    capacity: 1,
  });

  const loadAll = async () => {
    setLoading(true);
    setLoadError(null);
    setTimedOut(false);
    try {
      const [cList, eList, rList, conf] = await Promise.all([
        apiRequest<CrewItem[]>('/crews'),
        apiRequest<EquipmentItem[]>('/equipment'),
        apiRequest<TaskRuleItem[]>('/task-rules'),
        apiRequest<{ conflicts: any[] }>('/resources/conflicts'),
      ]);
      setCrews(cList);
      setEquipment(eList);
      setRules(rList);
      setConflicts(conf.conflicts || []);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load resources');
      pushToast('Resource Load Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const toggleCrewAvailability = async (c: CrewItem) => {
    try {
      await apiRequest(`/crews/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_available: !c.is_available }),
      });
      pushToast(
        'Crew Availability Updated',
        `${c.code} (${c.name}) is now ${!c.is_available ? 'AVAILABLE' : 'UNAVAILABLE'}`,
        !c.is_available ? 'success' : 'warning',
      );
      await loadAll();
    } catch (err: any) {
      pushToast('Update Failed', err.message, 'error');
    }
  };

  const toggleEquipmentStatus = async (e: EquipmentItem) => {
    const nextStatus = e.status === 'operational' ? 'failed' : 'operational';
    try {
      await apiRequest(`/equipment/${e.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus, is_available: nextStatus === 'operational' }),
      });
      pushToast(
        'Equipment Status Changed',
        `${e.code} (${e.name}) set to ${nextStatus.toUpperCase()}`,
        nextStatus === 'operational' ? 'success' : 'warning',
      );
      await loadAll();
    } catch (err: any) {
      pushToast('Update Failed', err.message, 'error');
    }
  };

  const handleAddCrew = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      await apiRequest('/crews', { method: 'POST', body: JSON.stringify(newCrew) });
      pushToast('Crew Registered', `Added ${newCrew.code}`, 'success');
      setNewCrew({ ...newCrew, code: `C-0${crews.length + 2}`, name: '', leader: '' });
      await loadAll();
    } catch (err: any) {
      pushToast('Create Crew Failed', err.message, 'error');
    }
  };

  const handleAddEquipment = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      await apiRequest('/equipment', { method: 'POST', body: JSON.stringify(newEq) });
      pushToast('Equipment Added', `Added ${newEq.code}`, 'success');
      setNewEq({ ...newEq, code: `EQ-0${equipment.length + 2}`, name: '' });
      await loadAll();
    } catch (err: any) {
      pushToast('Create Equipment Failed', err.message, 'error');
    }
  };

  const handleUpdateRule = async (r: TaskRuleItem, field: string, val: number) => {
    try {
      await apiRequest(`/task-rules/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: val }),
      });
      pushToast('Operational Rule Updated', `Updated ${r.code} (${field}=${val})`, 'info');
      await loadAll();
    } catch (err: any) {
      pushToast('Rule Update Failed', err.message, 'error');
    }
  };

  if (!crews.length) {
    if (timedOut || (loadError && !crews.length)) {
      return (
        <div className="p-6">
          <InlineError
            target="crews, equipment & rules"
            message={timedOut ? 'Request timed out after 20s. Could not load crews & equipment.' : undefined}
            onRetry={loadAll}
          />
        </div>
      );
    }

    if (loading || showSkeleton) {
      return (
        <div aria-busy="true" className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
            <SkeletonBlock height={28} width="50%" />
            <SkeletonBlock height={14} width="70%" />
          </div>
          {/* Crew Cards Skeleton */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <SkeletonCard height={170} />
            <SkeletonCard height={170} />
            <SkeletonCard height={170} />
            <SkeletonCard height={170} />
          </div>
          {/* Equipment Table Skeleton */}
          <SkeletonTable rows={4} cols={5} />
          {/* Operational Rules Table Skeleton */}
          <SkeletonTable rows={3} cols={6} />
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17211C]">
            Crew, Equipment & Operational Rule Management
          </h1>
          <p className="text-xs text-stone-600 mt-1">
            Configure field crews, shift hours, eligibility, sprayer equipment availability, and
            approved operational rules. Real-time conflict detection checks active schedules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {conflicts.length === 0 ? (
            <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-1.5">
              <span className="text-emerald-700 font-semibold">Pass</span> 0 Active Resource Conflicts
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-xs font-bold flex items-center gap-1.5">
              <strong className="text-red-700">Error</strong> {conflicts.length} Resource
              Conflict(s) Detected
            </span>
          )}
        </div>
      </div>

      {/* Resource Conflict Banner */}
      {conflicts.length > 0 && (
        <div className="bg-red-950 text-red-50 rounded-2xl p-5 border border-red-700 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-red-300 flex items-center gap-2">
            <strong>Warning</strong> Resource Conflicts Detected Against Active Plan
          </div>
          {conflicts.map((c, idx) => (
            <div key={idx} className="text-xs bg-red-900/50 p-2.5 rounded-lg border border-red-800">
              <strong>[{c.type.toUpperCase()}]</strong> {c.detail}
            </div>
          ))}
        </div>
      )}

      {/* Crews + Equipment Grid */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Crews Column */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            Field Protection & Inspection Crews
          </h2>

          <div className="space-y-3">
            {crews.length === 0 ? (
              <EmptyState message="No field crews configured yet." />
            ) : (
              crews.map((c) => (
                <div
                  key={c.id}
                  className="p-4 rounded-xl border border-stone-200 bg-stone-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-[#17211C]">{c.code}</span>
                      <span className="font-bold text-[#17211C]">{c.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          c.is_available
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {c.is_available ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                    <div className="text-stone-600 mt-1">
                      Leader: <strong>{c.leader || 'Assigned'}</strong> · Size: {c.size} · Shift:{' '}
                      {c.shift_start_hour}:00–{c.shift_end_hour}:00 IST · Max {c.max_hours_per_day}
                      h/day
                    </div>
                    <div className="text-[11px] text-stone-500 mt-0.5">
                      Eligible Tasks: <strong>{c.eligibility.join(', ')}</strong> · Scheduled Tasks in
                      Active Plan: <strong>{c.scheduled_task_count || 0}</strong>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleCrewAvailability(c)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 cursor-pointer ${
                      c.is_available
                        ? 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : 'bg-emerald-700 text-white hover:bg-emerald-600'
                    }`}
                  >
                    {c.is_available ? 'Mark Unavailable' : 'Restore Available'}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Quick Add Crew Form */}
          <form
            onSubmit={handleAddCrew}
            className="pt-4 border-t border-stone-200 grid sm:grid-cols-4 gap-2 text-xs"
          >
            <input
              type="text"
              required
              placeholder="Code (e.g. C-05)"
              value={newCrew.code}
              onChange={(e) => setNewCrew({ ...newCrew, code: e.target.value })}
              className="px-3 py-2 rounded-lg border border-stone-300 font-mono"
            />
            <input
              type="text"
              required
              placeholder="Crew Name"
              value={newCrew.name}
              onChange={(e) => setNewCrew({ ...newCrew, name: e.target.value })}
              className="px-3 py-2 rounded-lg border border-stone-300"
            />
            <input
              type="text"
              placeholder="Crew Leader"
              value={newCrew.leader}
              onChange={(e) => setNewCrew({ ...newCrew, leader: e.target.value })}
              className="px-3 py-2 rounded-lg border border-stone-300"
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-lg bg-[#0C1F17] text-white font-bold flex items-center justify-center gap-1 cursor-pointer"
            >
              Add Crew
            </button>
          </form>
        </div>

        {/* Equipment Column */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            Sprayer & Inspection Equipment Registry
          </h2>

          <div className="space-y-3">
            {equipment.map((e) => (
              <div
                key={e.id}
                className="p-4 rounded-xl border border-stone-200 bg-stone-50/70 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[#17211C]">{e.code}</span>
                    <span className="font-bold text-[#17211C]">{e.name}</span>
                  </div>
                  <div className="text-stone-600 mt-1">
                    Type: <code className="font-mono">{e.type}</code> · Simultaneous Capacity:{' '}
                    <strong>{e.capacity}</strong>
                  </div>
                  <div className="mt-1">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        e.status === 'operational'
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {e.status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => toggleEquipmentStatus(e)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 cursor-pointer ${
                    e.status === 'operational'
                      ? 'border border-red-300 bg-red-50 text-red-900 hover:bg-red-100'
                      : 'bg-emerald-700 text-white hover:bg-emerald-600'
                  }`}
                >
                  {e.status === 'operational' ? 'Simulate Failure' : 'Mark Operational'}
                </button>
              </div>
            ))}
          </div>

          <form
            onSubmit={handleAddEquipment}
            className="pt-4 border-t border-stone-200 grid sm:grid-cols-3 gap-2 text-xs"
          >
            <input
              type="text"
              required
              placeholder="Code (EQ-05)"
              value={newEq.code}
              onChange={(e) => setNewEq({ ...newEq, code: e.target.value })}
              className="px-3 py-2 rounded-lg border border-stone-300 font-mono"
            />
            <input
              type="text"
              required
              placeholder="Equipment Name"
              value={newEq.name}
              onChange={(e) => setNewEq({ ...newEq, name: e.target.value })}
              className="px-3 py-2 rounded-lg border border-stone-300"
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-lg bg-[#0C1F17] text-white font-bold flex items-center justify-center gap-1 cursor-pointer"
            >
              Add Unit
            </button>
          </form>
        </div>
      </div>

      {/* Approved Operational Rules */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
        <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2 mb-4">
          Approved Operational Task Rules
          (Used by Optimizer & Validator)
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {rules.map((r) => (
            <div key={r.id} className="p-4 rounded-xl border border-stone-200 bg-stone-50 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-[#17211C]">
                  {r.code} — {r.name}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[10px]">
                  {r.evidence_label}
                </span>
              </div>
              <p className="text-stone-600">{r.description}</p>
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500">
                    Minutes / Acre
                  </label>
                  <input
                    type="number"
                    value={r.minutes_per_acre}
                    onChange={(e) =>
                      handleUpdateRule(r, 'minutes_per_acre', Number(e.target.value))
                    }
                    className="w-full px-2 py-1 rounded border border-stone-300 bg-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500">
                    Dry Hours After
                  </label>
                  <input
                    type="number"
                    value={r.dry_hours_after}
                    onChange={(e) =>
                      handleUpdateRule(r, 'dry_hours_after', Number(e.target.value))
                    }
                    className="w-full px-2 py-1 rounded border border-stone-300 bg-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500">
                    Min Window Prob
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={r.min_window_probability}
                    onChange={(e) =>
                      handleUpdateRule(r, 'min_window_probability', Number(e.target.value))
                    }
                    className="w-full px-2 py-1 rounded border border-stone-300 bg-white mt-0.5"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
