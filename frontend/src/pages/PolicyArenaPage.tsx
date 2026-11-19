import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import {
  ActionStatusLine,
  InlineError,
  SkeletonBlock,
  SkeletonCard,
  SkeletonChart,
  SkeletonTable,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

export const PolicyArenaPage: React.FC = () => {
  const { pushToast } = useApp();
  const [sensitivity, setSensitivity] = useState<'low' | 'base' | 'high'>('base');
  const [evalMode, setEvalMode] = useState<'in_sample' | 'holdout'>('in_sample');
  const [arenaData, setArenaData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [arenaDone, setArenaDone] = useState<boolean>(false);
  const [arenaError, setArenaError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState<boolean>(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const runComparison = async (
    sens: 'low' | 'base' | 'high' = sensitivity,
    mode: 'in_sample' | 'holdout' = evalMode,
  ) => {
    setRunning(true);
    setArenaDone(false);
    setArenaError(null);
    setTimedOut(false);
    try {
      const res = await apiRequest('/policies/compare', {
        method: 'POST',
        body: JSON.stringify({
          sensitivity: sens,
          evaluation_mode: mode,
          time_limit_s: 6.0,
          seed: 42,
        }),
      });
      setArenaData(res);
      setArenaDone(true);
      setTimeout(() => setArenaDone(false), 2500);
      pushToast(
        'Policy Arena Evaluated',
        `Compared Calendar, Reactive, and MahaliShield Optimized policies in ${res.duration_ms} ms`,
        'success',
      );
    } catch (err: any) {
      setArenaError(err.message || 'Comparison failed');
      pushToast('Policy Comparison Error', err.message, 'error');
    } finally {
      setRunning(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    runComparison();
  }, []);

  if (!arenaData) {
    if (timedOut || (!loading && !arenaData)) {
      return (
        <div className="p-6">
          <InlineError
            target="Policy Arena evaluation"
            message={timedOut ? 'Request timed out after 20s. Could not load policy evaluation.' : undefined}
            onRetry={() => runComparison()}
          />
        </div>
      );
    }

    if (loading || showSkeleton) {
      return (
        <div aria-busy="true" className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
            <SkeletonBlock height={20} width={220} radius={999} />
            <SkeletonBlock height={28} width="50%" />
            <SkeletonBlock height={14} width="70%" />
          </div>
          {/* Three Summary Cards Skeleton */}
          <div className="grid md:grid-cols-3 gap-6">
            <SkeletonCard height={200} />
            <SkeletonCard height={200} />
            <SkeletonCard height={200} />
          </div>
          {/* Two Charts Skeleton */}
          <div className="grid lg:grid-cols-2 gap-6">
            <SkeletonChart height={300} />
            <SkeletonChart height={300} />
          </div>
          {/* Matrix Table Skeleton */}
          <SkeletonTable rows={6} cols={4} />
        </div>
      );
    }
  }

  const policies = arenaData?.policies || {};
  const defs = arenaData?.metric_definitions || {};
  const cal = policies.calendar;
  const react = policies.reactive;
  const opt = policies.optimized;

  const exposureChartData = [
    {
      metric: 'Expected Weighted Exposure',
      Calendar: cal?.metrics?.expected_weighted_exposure,
      Reactive: react?.metrics?.expected_weighted_exposure,
      Optimized: opt?.metrics?.expected_weighted_exposure,
    },
    {
      metric: 'Tail Exposure (CVaR 90%)',
      Calendar: cal?.metrics?.tail_exposure_cvar90,
      Reactive: react?.metrics?.tail_exposure_cvar90,
      Optimized: opt?.metrics?.tail_exposure_cvar90,
    },
    {
      metric: 'Unweighted Exposure-Hours',
      Calendar: cal?.metrics?.exposure_hours,
      Reactive: react?.metrics?.exposure_hours,
      Optimized: opt?.metrics?.exposure_hours,
    },
  ];

  const opsChartData = [
    {
      metric: 'Acreage Covered (ac)',
      Calendar: cal?.metrics?.acreage_covered,
      Reactive: react?.metrics?.acreage_covered,
      Optimized: opt?.metrics?.acreage_covered,
    },
    {
      metric: 'Missed Windows',
      Calendar: cal?.metrics?.missed_feasible_windows,
      Reactive: react?.metrics?.missed_feasible_windows,
      Optimized: opt?.metrics?.missed_feasible_windows,
    },
    {
      metric: 'Rain Disruptions',
      Calendar: cal?.metrics?.replanning_disruption,
      Reactive: react?.metrics?.replanning_disruption,
      Optimized: opt?.metrics?.replanning_disruption,
    },
    {
      metric: 'Travel Time (h)',
      Calendar: cal?.metrics?.travel_hours,
      Reactive: react?.metrics?.travel_hours,
      Optimized: opt?.metrics?.travel_hours,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-300">
                IDENTICAL INITIAL CONDITIONS & CONSTRAINTS
              </span>
              <span className="text-xs font-mono text-stone-600">
                Twin: {arenaData?.parameter_version} ({arenaData?.sensitivity})
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[#17211C] mt-2">
              Policy Arena — Fair Scheduling Policy Evaluation
            </h1>
            <p className="text-xs text-stone-600 mt-1">
              Compares Policy A (Calendar-Based), Policy B (Reactive First-Window), and Policy C
              (MahaliShield CP-SAT Optimized) on the exact same plots, crews, equipment, and
              rainfall ensemble.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={sensitivity}
              onChange={(e) => {
                const s = e.target.value as 'low' | 'base' | 'high';
                setSensitivity(s);
                runComparison(s, evalMode);
              }}
              className="px-3 py-2 rounded-xl border border-stone-300 bg-white font-semibold"
            >
              <option value="low">Low Sensitivity</option>
              <option value="base">Base Sensitivity</option>
              <option value="high">High Sensitivity</option>
            </select>

            <select
              value={evalMode}
              onChange={(e) => {
                const m = e.target.value as 'in_sample' | 'holdout';
                setEvalMode(m);
                runComparison(sensitivity, m);
              }}
              className="px-3 py-2 rounded-xl border border-stone-300 bg-white font-semibold"
            >
              <option value="in_sample">In-Sample Ensemble Evaluation</option>
              <option value="holdout">Out-of-Sample Holdout (Even Plan / Odd Eval)</option>
            </select>

            <button
              onClick={() => runComparison(sensitivity, evalMode)}
              disabled={running}
              className="px-4 py-2 rounded-xl bg-[#0C1F17] hover:bg-emerald-950 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {running ? 'Evaluating...' : 'Re-Run Arena'}
            </button>
            <ActionStatusLine
              isRunning={running}
              actionName="Comparing policies"
              timeLimit={6}
              isDone={arenaDone}
              error={arenaError}
              onRetry={() => runComparison(sensitivity, evalMode)}
            />
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-700 flex items-start gap-2">
          <div>
            <strong>Fairness Guarantee:</strong> All three policies use the same{' '}
            <code>ListScheduler</code> / <code>CP-SAT</code> hard resource rules (shifts, travel
            buffers, equipment capacity, task durations, and precedence). Baseline policies are
            never artificially weakened.
          </div>
        </div>
      </div>

      {/* Three Policy Cards */}
      <div className="grid lg:grid-cols-3 gap-6">
        {(['calendar', 'reactive', 'optimized'] as const).map((key) => {
          const p = policies[key];
          if (!p) return null;
          const isOpt = key === 'optimized';
          return (
            <div
              key={key}
              className={`rounded-2xl p-6 border shadow-xs space-y-4 ${
                isOpt
                  ? 'bg-[#0C1F17] text-white border-emerald-700'
                  : 'bg-white text-[#17211C] border-stone-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                    isOpt
                      ? 'bg-emerald-500 text-[#0C1F17]'
                      : 'bg-stone-100 text-stone-700 border border-stone-200'
                  }`}
                >
                  {p.name}
                </span>
                <span className="text-xs font-mono opacity-80">{p.solver?.status}</span>
              </div>
              <p className={`text-xs leading-relaxed ${isOpt ? 'text-emerald-100/80' : 'text-stone-600'}`}>
                {p.description}
              </p>

              <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                <div
                  className={`p-3 rounded-xl border ${
                    isOpt ? 'bg-emerald-950/80 border-emerald-800' : 'bg-stone-50 border-stone-200'
                  }`}
                >
                  <div className="text-[10px] opacity-75 uppercase">Expected Weighted Exposure</div>
                  <div className="text-lg font-bold font-mono mt-0.5">
                    {p.metrics.expected_weighted_exposure}
                  </div>
                  {key !== 'calendar' && p.pct_vs_calendar?.expected_weighted_exposure != null && (
                    <div
                      className={`text-[11px] font-bold ${
                        p.pct_vs_calendar.expected_weighted_exposure <= 0
                          ? isOpt
                            ? 'text-emerald-300'
                            : 'text-emerald-700'
                          : 'text-amber-500'
                      }`}
                    >
                      {p.pct_vs_calendar.expected_weighted_exposure > 0 ? '+' : ''}
                      {p.pct_vs_calendar.expected_weighted_exposure}% vs Calendar
                    </div>
                  )}
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    isOpt ? 'bg-emerald-950/80 border-emerald-800' : 'bg-stone-50 border-stone-200'
                  }`}
                >
                  <div className="text-[10px] opacity-75 uppercase">Acreage Covered</div>
                  <div className="text-lg font-bold font-mono mt-0.5">
                    {p.metrics.acreage_covered} / {p.metrics.acreage_total} ac
                  </div>
                  <div className="text-[11px] opacity-80">
                    Completion: {(p.metrics.completion_rate * 100).toFixed(1)}%
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    isOpt ? 'bg-emerald-950/80 border-emerald-800' : 'bg-stone-50 border-stone-200'
                  }`}
                >
                  <div className="text-[10px] opacity-75 uppercase">Tail Exposure (CVaR 90%)</div>
                  <div className="text-base font-bold font-mono mt-0.5">
                    {p.metrics.tail_exposure_cvar90}
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    isOpt ? 'bg-emerald-950/80 border-emerald-800' : 'bg-stone-50 border-stone-200'
                  }`}
                >
                  <div className="text-[10px] opacity-75 uppercase">Rain Disruptions</div>
                  <div className="text-base font-bold font-mono mt-0.5">
                    {p.metrics.replanning_disruption} tasks
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Comparison Bar Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <h2 className="text-sm font-bold text-[#17211C] mb-1">
            Simulated Exposure Metrics (Lower is Better)
          </h2>
          <p className="text-xs text-stone-500 mb-4">
            Expected weighted exposure, 90% tail CVaR, and unweighted exposure-hours.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={exposureChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Calendar" fill="#78716c" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Reactive" fill="#d97706" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Optimized" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <h2 className="text-sm font-bold text-[#17211C] mb-1">
            Operational Coverage, Disruptions & Travel
          </h2>
          <p className="text-xs text-stone-500 mb-4">
            Acreage protected without wash-off, missed feasible windows, and crew travel hours.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={opsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Calendar" fill="#78716c" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Reactive" fill="#d97706" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Optimized" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Complete Metrics Table with Absolute & Percentage Differences */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs overflow-x-auto">
        <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2 mb-4">
          Comprehensive Policy Comparison Matrix (Absolute Values & % Deltas)
        </h2>
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-stone-200 text-stone-500 uppercase text-[10px]">
              <th className="py-2.5 pr-4">Evaluation Metric</th>
              <th className="py-2.5 pr-4">Direction</th>
              <th className="py-2.5 pr-4">Policy A: Calendar</th>
              <th className="py-2.5 pr-4">Policy B: Reactive (% vs A)</th>
              <th className="py-2.5 pr-4">Policy C: MahaliShield (% vs A)</th>
              <th className="py-2.5">Policy C vs Reactive B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {Object.entries(defs).map(([mKey, def]: [string, any]) => {
              const vA = cal?.metrics?.[mKey];
              const vB = react?.metrics?.[mKey];
              const vC = opt?.metrics?.[mKey];
              const dBA = react?.pct_vs_calendar?.[mKey];
              const dCA = opt?.pct_vs_calendar?.[mKey];
              const dCB = opt?.pct_vs_reactive?.[mKey];
              return (
                <tr key={mKey} className="hover:bg-stone-50">
                  <td className="py-3 pr-4">
                    <div className="font-bold text-[#17211C]">{def.label}</div>
                    <div className="text-[11px] text-stone-500">{def.definition}</div>
                  </td>
                  <td className="py-3 pr-4 font-mono uppercase text-[10px] text-stone-600">
                    {def.better}
                  </td>
                  <td className="py-3 pr-4 font-mono font-semibold">{vA}</td>
                  <td className="py-3 pr-4 font-mono">
                    <strong>{vB}</strong>{' '}
                    {dBA != null && (
                      <span className="text-stone-500">
                        ({dBA > 0 ? '+' : ''}
                        {dBA}%)
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono font-bold text-emerald-900">
                    {vC}{' '}
                    {dCA != null && (
                      <span className="text-emerald-700">
                        ({dCA > 0 ? '+' : ''}
                        {dCA}%)
                      </span>
                    )}
                  </td>
                  <td className="py-3 font-mono font-semibold text-emerald-800">
                    {dCB != null ? `${dCB > 0 ? '+' : ''}${dCB}%` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
