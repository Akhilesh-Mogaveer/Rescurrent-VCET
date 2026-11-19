import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

export const RiskTwinPage: React.FC = () => {
  const { pushToast } = useApp();
  const [sensitivity, setSensitivity] = useState<'low' | 'base' | 'high'>('base');
  const [simData, setSimData] = useState<any>(null);
  const [selectedPlotId, setSelectedPlotId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [simDone, setSimDone] = useState<boolean>(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState<boolean>(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const runSimulation = async (sens: 'low' | 'base' | 'high') => {
    setRunning(true);
    setSimDone(false);
    setSimError(null);
    setTimedOut(false);
    try {
      const res = await apiRequest('/simulations', {
        method: 'POST',
        body: JSON.stringify({ sensitivity: sens, seed: 42 }),
      });
      setSimData(res);
      if (!selectedPlotId && res.priority_queue?.length) {
        setSelectedPlotId(res.priority_queue[0].plot_id);
      }
      setSimDone(true);
      setTimeout(() => setSimDone(false), 2500);
      pushToast(
        'Twin Simulation Executed',
        `Model ${res.parameter_set.version} completed in ${res.duration_ms} ms (input hash ${res.input_hash.slice(0, 10)})`,
        'success',
      );
    } catch (err: any) {
      setSimError(err.message || 'Simulation failed');
      pushToast('Simulation Failed', err.message, 'error');
    } finally {
      setRunning(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    runSimulation(sensitivity);
  }, []);

  if (!simData) {
    if (timedOut || (!loading && !simData)) {
      return (
        <div className="p-6">
          <InlineError
            target="Risk & Protection Twin"
            message={timedOut ? 'Request timed out after 20s. Could not load Risk Twin simulation.' : undefined}
            onRetry={() => runSimulation(sensitivity)}
          />
        </div>
      );
    }

    if (loading || showSkeleton) {
      return (
        <div aria-busy="true" className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
            <SkeletonBlock height={20} width={250} radius={999} />
            <SkeletonBlock height={28} width="60%" />
            <SkeletonBlock height={14} width="70%" />
          </div>
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4">
              <SkeletonCard height={320} />
            </div>
            <div className="lg:col-span-8">
              <SkeletonChart height={320} />
            </div>
          </div>
          <SkeletonTable rows={6} cols={6} />
        </div>
      );
    }
  }

  const summaries: any[] = simData?.summaries || [];
  const queue: any[] = simData?.priority_queue || [];
  const params: Record<string, number> = simData?.parameter_set?.params || {};
  const currentSummary =
    summaries.find((s) => s.plot_id === selectedPlotId) || summaries[0] || null;
  const currentRank = queue.find((q) => q.plot_id === currentSummary?.plot_id);

  const hoursCount = currentSummary?.series?.wetness?.p50?.length || 0;
  const chartData = Array.from({ length: hoursCount }, (_, h) => ({
    hour: `+${h}h`,
    wetness_p50: currentSummary.series.wetness.p50[h],
    hazard_p50: currentSummary.series.hazard.p50[h],
    protection_p50: currentSummary.series.protection.p50[h],
    exposure_p50: currentSummary.series.exposure.p50[h],
    exposure_p90: currentSummary.series.exposure.p90[h],
    exposure_p10: currentSummary.series.exposure.p10[h],
  }));

  return (
    <div className="space-y-6">
      {/* Header & Scientific Scope Notice */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-300">
                MODEL ASSUMPTION
              </span>
              <span className="text-xs font-mono text-stone-600">
                Version: {simData?.parameter_set?.version}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[#17211C] mt-2">
              Agricultural Risk & Protection Twin
            </h1>
            <p className="text-xs text-stone-600 mt-1">
              Transparent state-space simulation of Wetness Proxy W(t), Environmental Hazard Proxy
              H(t), Protection State P(t), and Relative Exposure E(t) = H(t) × (1 − P(t)).
            </p>
          </div>

          <div className="flex items-center gap-2">
            {(['low', 'base', 'high'] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSensitivity(s);
                  runSimulation(s);
                }}
                disabled={running}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase border transition cursor-pointer ${
                  sensitivity === s
                    ? 'bg-[#0C1F17] text-white border-[#0C1F17]'
                    : 'bg-stone-50 text-stone-700 border-stone-300 hover:bg-stone-100'
                }`}
              >
                {s} Sensitivity
              </button>
            ))}
            <button
              onClick={() => runSimulation(sensitivity)}
              disabled={running}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {running ? 'Simulating...' : 'Re-Run Twin'}
            </button>
            <ActionStatusLine
              isRunning={running}
              actionName="Simulating"
              isDone={simDone}
              error={simError}
              onRetry={() => runSimulation(sensitivity)}
            />
          </div>
        </div>

        {/* Scientific Disclaimer Box */}
        <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
          <div>
            <strong>Scientific Scope & Limitations:</strong> {simData?.scientific_disclaimer} These
            equations represent configurable operational decision-support proxies for comparing
            scheduling policies — not a field-calibrated koleroga epidemiological model.
          </div>
        </div>
      </div>

      {/* Plot Selector + Trajectory Charts */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left Plot Priority Queue Selector */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-stone-200 p-5 flex flex-col">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2 mb-3">
            Select Plot to Inspect Prioritization
          </h2>
          <div className="space-y-2 overflow-y-auto max-h-[520px] pr-1">
            {queue.map((q) => {
              const s = summaries.find((x) => x.plot_id === q.plot_id);
              const active = q.plot_id === currentSummary?.plot_id;
              return (
                <div
                  key={q.plot_id}
                  onClick={() => setSelectedPlotId(q.plot_id)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer ${
                    active
                      ? 'bg-[#0C1F17] text-white border-emerald-600'
                      : 'bg-stone-50 hover:bg-stone-100 border-stone-200 text-[#17211C]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">
                      #{q.rank} · {q.code}
                    </span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        active ? 'text-emerald-300' : 'text-emerald-800'
                      }`}
                    >
                      Weighted Score: {q.score.toFixed(2)}
                    </span>
                  </div>
                  <div
                    className={`text-[11px] mt-1 ${active ? 'text-emerald-100/80' : 'text-stone-600'}`}
                  >
                    Mean E: {q.exposure_hours_mean.toFixed(2)}h · P90 E:{' '}
                    {q.exposure_hours_p90.toFixed(2)}h · Protection P(0):{' '}
                    {((s?.current_protection || 0) * 100).toFixed(0)}%
                  </div>
                  <div
                    className={`text-[11px] mt-1.5 font-medium ${
                      active ? 'text-amber-300' : 'text-amber-900'
                    }`}
                  >
                    Why prioritized: {q.factors.join('; ')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Twin Trajectories & Equations */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#17211C] flex items-center gap-2">
                  Plot {currentSummary?.code} — Wetness W(t), Hazard H(t), Protection P(t) &
                  Relative Exposure E(t)
                </h2>
                <p className="text-xs text-stone-500">
                  No-action baseline trajectory across {simData?.scenario_set?.member_count || 30}{' '}
                  ensemble scenarios ({sensitivity.toUpperCase()} sensitivity).
                </p>
              </div>
              <div className="text-xs font-mono bg-stone-100 px-3 py-1.5 rounded-lg">
                Plot weight: <strong>{currentSummary?.weight}</strong> · Retention:{' '}
                <strong>{currentSummary?.retention}</strong>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e5" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={5} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="wetness_p50" stroke="#2563eb" strokeWidth={2} dot={false} name="Wetness Proxy W(t) [Median]" />
                  <Line type="monotone" dataKey="hazard_p50" stroke="#d97706" strokeWidth={2} dot={false} name="Hazard Proxy H(t) [Median]" />
                  <Line type="monotone" dataKey="protection_p50" stroke="#059669" strokeWidth={2} dot={false} name="Protection State P(t) [Median]" />
                  <Line type="monotone" dataKey="exposure_p50" stroke="#dc2626" strokeWidth={2.5} dot={false} name="Relative Exposure E(t) [Median]" />
                  <Line type="monotone" dataKey="exposure_p90" stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} dot={false} name="Relative Exposure E(t) [P90]" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {currentRank && (
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-xs space-y-1.5">
                <div className="font-bold text-[#17211C]">
                  Explainable Prioritization Breakdown for {currentSummary?.code} (Rank #
                  {currentRank.rank} · {(currentRank.share * 100).toFixed(1)}% of cluster exposure):
                </div>
                <ul className="list-disc pl-5 space-y-1 text-stone-700">
                  {currentRank.factors.map((f: string, idx: number) => (
                    <li key={idx}>{f}</li>
                  ))}
                  <li>
                    Expected wet duration: <strong>{currentSummary.expected_wet_hours}h</strong>{' '}
                    above wet threshold ({params.wet_threshold}).
                  </li>
                  <li>
                    Protection state decays from{' '}
                    <strong>{(currentSummary.current_protection * 100).toFixed(0)}%</strong> to
                    median <strong>{(currentSummary.protection_end_median * 100).toFixed(0)}%</strong>{' '}
                    by +72h due to background decay and rainfall wash-off.
                  </li>
                </ul>
              </div>
            )}
          </div>

          {/* Link to Model Parameters in Governance */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
                Model Parameters ({sensitivity.toUpperCase()} Sensitivity)
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Configured coefficients and physical assumptions are governed in the model registry.
              </p>
            </div>
            <Link
              to="/governance"
              className="px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold flex items-center gap-1.5 self-start sm:self-center transition"
            >
              View model parameters
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
