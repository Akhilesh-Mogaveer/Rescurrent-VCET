import React, { useEffect, useState } from 'react';
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  AlertTriangle,
  CloudRain,
  Clock,
  Globe2,
  RefreshCw,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import type { DryWindow, WeatherMeta } from '../types';

export const RainGapPage: React.FC = () => {
  const { pushToast } = useApp();
  const [statusData, setStatusData] = useState<{
    active_set: WeatherMeta | null;
    available_sets: WeatherMeta[];
    last_fetch_error: { message?: string | null; at?: string | null };
  } | null>(null);
  const [scenarioData, setScenarioData] = useState<any>(null);
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);
  const [selectedMember, setSelectedMember] = useState<number | 'none'>(0);
  const [hourCursor, setHourCursor] = useState<number>(8);
  const [opHours, setOpHours] = useState<number>(2);
  const [dryHours, setDryHours] = useState<number>(3);
  const [maxRain, setMaxRain] = useState<number>(0.3);
  const [minProb, setMinProb] = useState<number>(0.6);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchingLive, setFetchingLive] = useState<boolean>(false);

  const loadForecast = async (setId?: number | null) => {
    setLoading(true);
    try {
      const st = await apiRequest('/forecast/status');
      setStatusData(st);
      const targetId = setId ?? selectedSetId ?? st.active_set?.id;
      const params = new URLSearchParams({
        op_hours: String(opHours),
        dry_hours: String(dryHours),
        max_rain: String(maxRain),
        min_prob: String(minProb),
      });
      if (targetId) params.set('set_id', String(targetId));
      const sc = await apiRequest(`/forecast/scenarios?${params.toString()}`);
      setScenarioData(sc);
      if (sc.meta?.id) setSelectedSetId(sc.meta.id);
    } catch (err: any) {
      pushToast('Weather Load Error', err.message || 'Failed to load scenarios', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForecast();
  }, [opHours, dryHours, maxRain, minProb]);

  const handleFetchLive = async () => {
    setFetchingLive(true);
    try {
      const res = await apiRequest('/forecast/refresh', { method: 'POST' });
      if (res.refreshed) {
        pushToast(
          'Live Ensemble Retrieved',
          `Fetched ${res.scenario_set.member_count} members from Open-Meteo (${res.scenario_set.model})`,
          'success',
        );
        setSelectedSetId(res.scenario_set.id);
        await loadForecast(res.scenario_set.id);
      } else {
        pushToast(
          'Live API Unreachable — Cached/Demo Active',
          `${res.error}. Continuing with clearly labeled ${res.scenario_set?.source_type?.toUpperCase()} set.`,
          'warning',
        );
        await loadForecast(res.scenario_set?.id);
      }
    } catch (err: any) {
      pushToast('Live Fetch Failed', err.message || 'Could not reach Open-Meteo', 'error');
    } finally {
      setFetchingLive(false);
    }
  };

  const handleGenerateSynthetic = async (seed: number, wetness: number) => {
    try {
      const meta = await apiRequest(
        `/forecast/synthetic?seed=${seed}&members=30&wetness=${wetness}`,
        { method: 'POST' },
      );
      pushToast('Synthetic Ensemble Created', meta.label, 'info');
      setSelectedSetId(meta.id);
      await loadForecast(meta.id);
    } catch (err: any) {
      pushToast('Generator Error', err.message, 'error');
    }
  };

  if (loading && !scenarioData) {
    return <div className="p-12 text-center text-sm text-stone-600">Loading Rain-Gap Twin...</div>;
  }

  const meta: WeatherMeta | undefined = scenarioData?.meta;
  const times: string[] = scenarioData?.times || [];
  const pct = scenarioData?.percentiles || {};
  const members: { member_id: number; rainfall: number[] }[] = scenarioData?.members || [];
  const winProb: number[] = scenarioData?.window_probability || [];
  const rainReturn: (number | null)[] = scenarioData?.rain_return_probability || [];
  const windows: DryWindow[] = scenarioData?.windows || [];

  const memberSeries =
    selectedMember === 'none'
      ? null
      : members.find((m) => m.member_id === selectedMember)?.rainfall || null;

  const chartData = times.map((_iso, idx) => ({
    hour: idx,
    label: `+${idx}h`,
    p10: pct.p10?.[idx] ?? 0,
    p25: pct.p25?.[idx] ?? 0,
    p50: pct.p50?.[idx] ?? 0,
    p75: pct.p75?.[idx] ?? 0,
    p90: pct.p90?.[idx] ?? 0,
    member: memberSeries ? memberSeries[idx] : undefined,
    winProbPct: Math.round((winProb[idx] ?? 0) * 100),
    rainReturnPct: rainReturn[idx] != null ? Math.round((rainReturn[idx] as number) * 100) : 0,
  }));

  const cursorRow = chartData[hourCursor] || chartData[0];

  return (
    <div className="space-y-6">
      {/* Header & Provenance Banner */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                meta?.is_synthetic
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-300'
              }`}
            >
              {meta?.is_synthetic ? 'SYNTHETIC / REPLAY SCENARIO SET' : 'LIVE OPEN-METEO ENSEMBLE'}
            </span>
            <span className="text-xs font-mono text-stone-600">
              Provider: {meta?.provider} · Model: {meta?.model} · {meta?.member_count} members
            </span>
            {meta?.is_stale && (
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-800">
                STALE DATA WARNING ({meta.age_hours}h old)
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-[#17211C] mt-2">
            Rain-Gap Twin — Ensemble Rainfall Uncertainty & Feasible Work Windows
          </h1>
          <p className="text-xs text-stone-600 mt-1">
            Geographic coverage: [{meta?.request_location?.join(', ')}] (Thirthahalli cluster) ·
            Fetched: {meta?.fetched_at ? new Date(meta.fetched_at).toLocaleString() : '-'} · Horizon
            start: {meta?.horizon_start ? new Date(meta.horizon_start).toLocaleString() : '-'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleFetchLive}
            disabled={fetchingLive}
            className="px-4 py-2 rounded-xl bg-[#0C1F17] hover:bg-emerald-950 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fetchingLive ? 'animate-spin' : ''}`} />
            {fetchingLive ? 'Contacting Open-Meteo...' : 'Fetch Live Open-Meteo Ensemble'}
          </button>
          <button
            onClick={() => handleGenerateSynthetic(108, 1.25)}
            className="px-3.5 py-2 rounded-xl border border-stone-300 hover:bg-stone-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-600" /> Replay Heavy Spell (Seed 108)
          </button>
        </div>
      </div>

      {statusData?.last_fetch_error?.message && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
          <div>
            <strong>Last Live API Notice:</strong> {statusData.last_fetch_error.message}. Showing
            explicitly labeled cached/synthetic ensemble scenarios — never silently substituting
            synthetic values as live forecasts.
          </div>
        </div>
      )}

      {/* Scenario Set Selector + Window Rule Sliders */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-emerald-700" /> Scenario Set & Member Selection
          </h2>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">
              Active Scenario Set
            </label>
            <select
              value={selectedSetId || ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelectedSetId(id);
                loadForecast(id);
              }}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 text-xs bg-white"
            >
              {(statusData?.available_sets || []).map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} [{s.source_type.toUpperCase()}] {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">
                Overlay Ensemble Member
              </label>
              <select
                value={selectedMember}
                onChange={(e) =>
                  setSelectedMember(e.target.value === 'none' ? 'none' : Number(e.target.value))
                }
                className="w-full px-3 py-2 rounded-lg border border-stone-300 text-xs bg-white"
              >
                <option value="none">None (Percentile Fan Only)</option>
                {members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    Member #{m.member_id} (
                    {m.rainfall.reduce((a, b) => a + b, 0).toFixed(1)} mm total)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">
                72h Cumulative Rain (P10 / Mean / P90)
              </label>
              <div className="px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-xs font-mono font-semibold text-stone-800">
                {scenarioData?.totals?.p10_total_mm} / {scenarioData?.totals?.mean_total_mm} /{' '}
                {scenarioData?.totals?.p90_total_mm} mm
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-700" /> Operational Window Feasibility Rule
          </h2>
          <div className="grid sm:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-stone-600">
                Task Duration: {opHours}h
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={opHours}
                onChange={(e) => setOpHours(Number(e.target.value))}
                className="w-full mt-2 accent-emerald-700"
              />
            </div>
            <div>
              <label className="block font-semibold text-stone-600">
                Post-Op Drying: {dryHours}h
              </label>
              <input
                type="range"
                min={1}
                max={6}
                value={dryHours}
                onChange={(e) => setDryHours(Number(e.target.value))}
                className="w-full mt-2 accent-emerald-700"
              />
            </div>
            <div>
              <label className="block font-semibold text-stone-600">
                Max Rain Threshold: {maxRain} mm/h
              </label>
              <input
                type="range"
                min={0.1}
                max={1.5}
                step={0.1}
                value={maxRain}
                onChange={(e) => setMaxRain(Number(e.target.value))}
                className="w-full mt-2 accent-emerald-700"
              />
            </div>
            <div>
              <label className="block font-semibold text-stone-600">
                Min Ensemble Prob: {Math.round(minProb * 100)}%
              </label>
              <input
                type="range"
                min={0.4}
                max={0.9}
                step={0.05}
                value={minProb}
                onChange={(e) => setMinProb(Number(e.target.value))}
                className="w-full mt-2 accent-emerald-700"
              />
            </div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Rule:</strong> A start hour is feasible if at least{' '}
              <strong>{Math.round(minProb * 100)}%</strong> of ensemble members stay ≤{' '}
              <strong>{maxRain} mm/h</strong> for <strong>{opHours + dryHours} consecutive hours</strong>{' '}
              ({opHours}h operation + {dryHours}h drying) during daylight shifts (07:00–18:00 IST).
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Rainfall Fan Chart */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#17211C] flex items-center gap-2">
              <CloudRain className="w-5 h-5 text-emerald-700" />
              Ensemble Rainfall Fan Chart (P10 / P25 / Median P50 / P75 / P90)
            </h2>
            <p className="text-xs text-stone-500">
              Hourly precipitation (mm/h) across {meta?.member_count} scenarios with interactive
              time-slider inspection.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-mono">
              Cursor: +{hourCursor}h · Median {cursorRow?.p50} mm/h (P90: {cursorRow?.p90} mm/h)
            </span>
            <span className="px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-900 font-mono">
              Rain-Return Risk: {cursorRow?.rainReturnPct}%
            </span>
          </div>
        </div>

        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={5} />
              <YAxis
                yAxisId="rain"
                tick={{ fontSize: 11 }}
                label={{ value: 'mm/h', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <YAxis
                yAxisId="prob"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 11 }}
                label={{ value: 'Dry Window %', angle: 90, position: 'insideRight', fontSize: 11 }}
              />
              <Tooltip />
              <Area
                yAxisId="rain"
                type="monotone"
                dataKey="p90"
                stroke="none"
                fill="#93c5fd"
                fillOpacity={0.3}
                name="P90 Rainfall (mm/h)"
              />
              <Area
                yAxisId="rain"
                type="monotone"
                dataKey="p75"
                stroke="none"
                fill="#3b82f6"
                fillOpacity={0.35}
                name="P75 Rainfall (mm/h)"
              />
              <Line
                yAxisId="rain"
                type="monotone"
                dataKey="p50"
                stroke="#1d4ed8"
                strokeWidth={2.5}
                dot={false}
                name="Median P50 (mm/h)"
              />
              <Line
                yAxisId="rain"
                type="monotone"
                dataKey="p10"
                stroke="#60a5fa"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
                name="P10 (mm/h)"
              />
              {selectedMember !== 'none' && (
                <Line
                  yAxisId="rain"
                  type="monotone"
                  dataKey="member"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={false}
                  name={`Member #${selectedMember} (mm/h)`}
                />
              )}
              <Line
                yAxisId="prob"
                type="stepAfter"
                dataKey="winProbPct"
                stroke="#059669"
                strokeWidth={2}
                dot={false}
                name="Feasible Dry Window (%)"
              />
              <ReferenceLine
                x={`+${hourCursor}h`}
                yAxisId="rain"
                stroke="#dc2626"
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Time Slider */}
        <div className="pt-2 border-t border-stone-200">
          <div className="flex items-center justify-between text-xs font-semibold text-stone-700 mb-1">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-emerald-700" />
              Interactive Horizon Time Slider: Hour +{hourCursor}h (
              {times[hourCursor] ? new Date(times[hourCursor]).toLocaleString() : ''})
            </span>
            <span>
              Dry Window Likelihood: <strong>{cursorRow?.winProbPct}%</strong> · Likelihood of Rain
              Returning Before Task Completion: <strong>{cursorRow?.rainReturnPct}%</strong>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, times.length - 1)}
            value={hourCursor}
            onChange={(e) => setHourCursor(Number(e.target.value))}
            className="w-full accent-[#0C1F17]"
          />
        </div>
      </div>

      {/* Detected Feasible Operational Windows */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
        <h2 className="text-sm font-bold text-[#17211C] mb-3">
          Detected Operational Rainfall Breaks ({windows.length} Windows Meet Rule)
        </h2>
        {windows.length === 0 ? (
          <div className="p-6 text-center text-xs text-stone-500 bg-stone-50 rounded-xl">
            No multi-hour window meets the current threshold. Try lowering the minimum ensemble
            probability or post-operation drying hours above to explore sensitivity.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {windows.map((w, i) => (
              <div
                key={i}
                onClick={() => setHourCursor(w.start_hour)}
                className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 transition cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-950">Window #{i + 1}</span>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-700 text-white">
                    Peak {(w.max_probability * 100).toFixed(0)}% Dry
                  </span>
                </div>
                <div className="text-sm font-bold text-[#17211C] mt-2">
                  Hours +{w.start_hour}h to +{w.end_hour}h
                </div>
                <div className="text-[11px] text-stone-600 mt-1">
                  Starts: {new Date(w.start_time).toLocaleString()}
                </div>
                <div className="mt-2 pt-2 border-t border-emerald-200/70 text-[11px] text-amber-900 font-medium">
                  Rain-return risk before drying completes:{' '}
                  <strong>{(w.rain_return_risk_at_best * 100).toFixed(0)}%</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
