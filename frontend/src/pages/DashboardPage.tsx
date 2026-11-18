import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import {
  Activity,
  ArrowRight,
  CalendarClock,
  Compass,
  Cpu,
  MapPin,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  apiRequest,
  cacheApprovedPlan,
  cacheDashboardSummary,
  getCachedApprovedPlan,
  getCachedDashboardSummary,
} from '../services/api';
import type { PlanItem, PlotItem, PriorityQueueItem } from '../types';
import { t } from '../utils/i18n';

function exposureColor(meanExp: number | undefined): string {
  if (meanExp === undefined) return '#059669';
  if (meanExp >= 18) return '#dc2626'; // critical relative exposure
  if (meanExp >= 12) return '#d97706'; // elevated relative exposure
  if (meanExp >= 7) return '#2563eb'; // moderate
  return '#059669'; // lower
}

export const DashboardPage: React.FC = () => {
  const { user, lang, pushToast } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [selectedPlotId, setSelectedPlotId] = useState<number | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/dashboard/summary');
      setData(res);
      setOfflineMode(false);
      cacheDashboardSummary(res);
      if (res.active_plan) {
        cacheApprovedPlan(res.active_plan);
      }
    } catch (err: any) {
      const cached = getCachedDashboardSummary();
      if (cached) {
        setData(cached.summary);
        setOfflineMode(true);
        pushToast(
          'Offline Snapshot Loaded',
          `Showing cached dashboard snapshot from ${new Date(cached.cached_at).toLocaleTimeString()}`,
          'warning',
        );
      } else {
        pushToast('Dashboard Load Error', err.message || 'Failed to load dashboard', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (loading && !data) {
    return (
      <div className="p-12 text-center text-stone-600 text-sm">
        Loading MahaliShield Operational Command Center...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 bg-white rounded-2xl border border-stone-200 text-center">
        <p className="text-sm text-stone-700">Unable to load dashboard data.</p>
        <button
          onClick={loadDashboard}
          className="mt-3 px-4 py-2 rounded-lg bg-[#0C1F17] text-white text-xs font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  const plots: PlotItem[] = data.plots || [];
  const queue: PriorityQueueItem[] = data.priority_queue || [];
  const activePlan: PlanItem | null = data.active_plan || getCachedApprovedPlan()?.plan || null;
  const weatherMeta = data.weather?.meta;
  const nextWindow = data.weather?.next_dry_window;
  const selectedPlot = plots.find((p) => p.id === selectedPlotId) || plots[0];
  const selectedQueueItem = queue.find((q) => q.plot_id === selectedPlot?.id);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#0C1F17] text-white rounded-2xl p-6 border border-emerald-900 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-800/80 text-emerald-200 border border-emerald-600/50">
              {user?.role === 'farmer' ? t(lang, 'farmer_portal_title') : t(lang, 'nav_dashboard')}
            </span>
            {weatherMeta?.is_synthetic ? (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40">
                {t(lang, 'synthetic_badge')} · {weatherMeta.label}
              </span>
            ) : (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                {t(lang, 'live_badge')}
              </span>
            )}
            {offlineMode && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-200 border border-red-400/40 flex items-center gap-1">
                <WifiOff className="w-3 h-3" /> {t(lang, 'offline_cached')}
              </span>
            )}
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold mt-2 tracking-tight">
            Thirthahalli Arecanut Protection Command Center
          </h1>
          <p className="text-xs lg:text-sm text-emerald-100/80 mt-1">
            {t(lang, 'subtitle')} — Relative simulated exposure & resource-feasible CP-SAT
            scheduling.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={loadDashboard}
            className="px-3.5 py-2 rounded-xl bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 border border-emerald-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <Link
            to="/planner"
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0C1F17] font-bold text-xs flex items-center gap-1.5"
          >
            <Cpu className="w-3.5 h-3.5" /> Run CP-SAT Optimizer
          </Link>
          <Link
            to="/replanning"
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0C1F17] font-bold text-xs flex items-center gap-1.5"
          >
            <Compass className="w-3.5 h-3.5" /> Dynamic Replanning
          </Link>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-stone-500">
            Monitored Plots / Farms
          </div>
          <div className="text-2xl font-bold text-[#17211C] mt-1">
            {data.counts.total_plots}{' '}
            <span className="text-xs font-normal text-stone-500">
              ({data.counts.total_farms} farms · {data.counts.total_acres} ac)
            </span>
          </div>
          <div className="text-[11px] text-emerald-700 mt-1 font-medium">
            Synthetic cluster labeled
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-stone-500">Active Crews</div>
          <div className="text-2xl font-bold text-[#17211C] mt-1">
            {data.counts.active_crews} / {data.counts.total_crews}
          </div>
          <div className="text-[11px] text-stone-600 mt-1">
            {data.counts.operational_equipment} operational equipment units
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-stone-500">
            Plots Requiring Attention
          </div>
          <div className="text-2xl font-bold text-amber-700 mt-1">
            {data.counts.plots_requiring_attention}
          </div>
          <div className="text-[11px] text-stone-600 mt-1">
            {data.counts.pending_operations} pending operations
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-stone-500">
            Next Feasible Dry Window
          </div>
          <div className="text-lg font-bold text-emerald-800 mt-1">
            {nextWindow ? `+${nextWindow.start_hour}h to +${nextWindow.end_hour}h` : 'None ≥60%'}
          </div>
          <div className="text-[11px] text-stone-600 mt-1">
            {nextWindow
              ? `Peak dry prob ${(nextWindow.max_probability * 100).toFixed(0)}% · Rain return ${(nextWindow.rain_return_risk_at_best * 100).toFixed(0)}%`
              : 'Wait for forecast break'}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-stone-500">
            Current Plan Status
          </div>
          <div className="text-lg font-bold text-[#17211C] mt-1">
            {activePlan ? `Plan #${activePlan.id} (v${activePlan.version})` : 'None'}
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold mt-1 uppercase">
            {activePlan
              ? `${activePlan.status} · ${activePlan.solver?.status || 'SOLVED'}`
              : 'Run optimizer'}
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-stone-500">
            Weather & Twin Freshness
          </div>
          <div className="text-sm font-bold text-[#17211C] mt-1 truncate">
            {weatherMeta?.provider || 'Synthetic'}
          </div>
          <div className="text-[11px] text-stone-600 mt-1">
            Twin {data.latest_simulation?.model_version || 'twin-0.3.0'} ·{' '}
            {weatherMeta?.member_count || 30} members
          </div>
        </div>
      </div>

      {/* Grower / Farmer Focused Advisory Card when role === 'farmer' (or visible to all as Grower Quick View) */}
      {user?.role === 'farmer' && (
        <div className="bg-emerald-950 text-emerald-50 rounded-2xl p-6 border border-emerald-700 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                {t(lang, 'farmer_portal_title')}
              </span>
              <h2 className="text-xl font-bold text-white mt-0.5">
                {t(lang, 'next_approved_plan')} & {t(lang, 'why_prioritized')}
              </h2>
            </div>
            <span className="text-xs px-3 py-1 rounded-full bg-emerald-800 text-emerald-200 font-mono">
              {t(lang, 'offline_cached')}
            </span>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-emerald-900/60 border border-emerald-700/60">
              <div className="text-xs text-emerald-300 font-semibold">
                {t(lang, 'upcoming_windows')}
              </div>
              {(data.weather?.windows || []).slice(0, 2).map((w: any, idx: number) => (
                <div key={idx} className="mt-2 text-xs border-t border-emerald-800 pt-2">
                  <div className="font-bold text-white">
                    Window {idx + 1}: +{w.start_hour}h to +{w.end_hour}h
                  </div>
                  <div className="text-emerald-200/80">
                    Dry window probability: {(w.max_probability * 100).toFixed(0)}% · Rain-return
                    risk: {(w.rain_return_risk_at_best * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-emerald-900/60 border border-emerald-700/60">
              <div className="text-xs text-emerald-300 font-semibold">
                Your Highest-Attention Plot: {selectedPlot?.code} ({selectedPlot?.name})
              </div>
              <div className="text-xs text-emerald-100 mt-2 space-y-1">
                <div>
                  Priority: <strong className="uppercase">{selectedPlot?.priority}</strong> · Area:{' '}
                  <strong>{selectedPlot?.area_acres} acres</strong>
                </div>
                <div>
                  Relative Simulated Exposure:{' '}
                  <strong>
                    {selectedPlot?.simulated_exposure?.exposure_hours_mean?.toFixed(2) || '-'} index-h
                  </strong>
                </div>
                <div className="text-emerald-200/90 mt-1">
                  Reasons: {(selectedQueueItem?.factors || []).join('; ')}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-900/60 border border-emerald-700/60">
              <div className="text-xs text-emerald-300 font-semibold">
                {t(lang, 'next_approved_plan')}
              </div>
              {activePlan?.assignments && activePlan.assignments.length > 0 ? (
                <div className="mt-2 space-y-2 max-h-36 overflow-y-auto text-xs">
                  {activePlan.assignments.slice(0, 4).map((a) => (
                    <div
                      key={a.id}
                      className="p-2 rounded bg-emerald-950/70 border border-emerald-800 flex justify-between"
                    >
                      <span>
                        <strong>{a.plot_code}</strong> ({a.task_code}) · {a.crew_code}
                      </span>
                      <span className="font-mono text-emerald-300">
                        Slot {a.start_slot}–{a.end_slot}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-emerald-200 mt-2">No approved assignments yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Geospatial Map + Risk Priority Queue */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Map Column */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-700" />
                Cluster Geospatial Exposure Map (Thirthahalli, Karnataka)
              </h2>
              <p className="text-xs text-stone-500">
                Click any plot marker to inspect relative simulated exposure, protection state, and
                assigned crew.
              </p>
            </div>
            {/* Accessible Legend */}
            <div className="flex items-center gap-3 text-[11px] font-medium">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" /> Critical (≥18)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" /> Elevated
                (12–18)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Moderate
                (7–12)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" /> Lower (&lt;7)
              </span>
            </div>
          </div>

          <div className="h-[420px] w-full relative">
            <MapContainer
              center={[13.69, 75.245]}
              zoom={13}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {plots.map((plot) => {
                const exp = plot.simulated_exposure?.exposure_hours_mean;
                const color = exposureColor(exp);
                return (
                  <CircleMarker
                    key={plot.id}
                    center={[plot.lat, plot.lon]}
                    radius={Math.max(9, Math.min(18, plot.area_acres * 4.5))}
                    pathOptions={{
                      color,
                      fillColor: color,
                      fillOpacity: 0.75,
                      weight: selectedPlot?.id === plot.id ? 4 : 2,
                    }}
                    eventHandlers={{
                      click: () => setSelectedPlotId(plot.id),
                    }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1">
                        <div className="font-bold text-sm">
                          {plot.code} — {plot.name}
                        </div>
                        <div className="text-stone-600">
                          Farm: {plot.farm_name} ({plot.area_acres} ac)
                        </div>
                        <div>
                          Priority: <strong className="uppercase">{plot.priority}</strong> ·
                          Drainage: <strong>{plot.drainage}</strong>
                        </div>
                        <div>
                          Relative Exposure:{' '}
                          <strong>{exp !== undefined ? `${exp.toFixed(2)} index-h` : 'N/A'}</strong>
                        </div>
                        <div>
                          Current Protection State:{' '}
                          <strong>{(plot.protection_state * 100).toFixed(0)}%</strong>
                        </div>
                        <div>
                          Assigned Crew:{' '}
                          <strong>{plot.assigned_crew_code || 'Pending assignment'}</strong>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>

          {/* Selected Plot Inspector Bar */}
          {selectedPlot && (
            <div className="p-4 bg-stone-50 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-[#17211C]">
                  Selected: {selectedPlot.code} — {selectedPlot.name} ({selectedPlot.area_acres} ac ·{' '}
                  <span className="uppercase text-emerald-800">{selectedPlot.priority}</span>)
                </div>
                <div className="text-stone-600 mt-0.5">
                  Why prioritized:{' '}
                  {(selectedQueueItem?.factors || ['Combined wetness and low protection state']).join(
                    ' · ',
                  )}
                </div>
              </div>
              <Link
                to="/risk-twin"
                className="px-3 py-1.5 rounded-lg bg-[#0C1F17] text-white font-semibold shrink-0 flex items-center gap-1"
              >
                Inspect Twin <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>

        {/* Priority Queue Column */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 shadow-xs flex flex-col">
          <div className="p-4 border-b border-stone-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                Simulated Exposure Priority Queue
              </h2>
              <p className="text-xs text-stone-500">
                Ranked by expected weighted relative exposure E(t) × plot weight across scenarios.
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
              SIMULATED RESULT
            </span>
          </div>

          <div className="divide-y divide-stone-100 overflow-y-auto max-h-[470px]">
            {queue.map((item) => {
              const plot = plots.find((p) => p.id === item.plot_id);
              return (
                <div
                  key={item.plot_id}
                  onClick={() => setSelectedPlotId(item.plot_id)}
                  className={`p-3.5 hover:bg-stone-50 transition cursor-pointer ${
                    selectedPlot?.id === item.plot_id ? 'bg-emerald-50/60' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#0C1F17] text-white text-xs font-bold flex items-center justify-center">
                        {item.rank}
                      </span>
                      <div>
                        <span className="font-bold text-xs text-[#17211C]">
                          {item.code} — {plot?.name}
                        </span>
                        <span className="ml-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700">
                          {plot?.priority} · {plot?.area_acres} ac
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-emerald-900">
                        Score {item.score.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-stone-500">
                        Mean {item.exposure_hours_mean.toFixed(1)}h · P90{' '}
                        {item.exposure_hours_p90.toFixed(1)}h
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[11px] text-stone-600 pl-8">
                    {item.factors.slice(0, 2).join(' · ')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Row: Upcoming Operational Tasks & Recent Activity Feed */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-emerald-700" />
                Upcoming Scheduled Operations (Plan #{activePlan?.id || '-'})
              </h3>
              <p className="text-xs text-stone-500">
                Validated crew-to-plot assignments respecting shift hours, travel buffers, and
                sprayer capacity.
              </p>
            </div>
            <Link
              to="/gantt"
              className="text-xs font-semibold text-emerald-800 hover:underline flex items-center gap-1"
            >
              Open Crew Gantt <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 uppercase text-[10px]">
                  <th className="py-2 pr-3">Task / Plot</th>
                  <th className="py-2 pr-3">Crew</th>
                  <th className="py-2 pr-3">Window (UTC)</th>
                  <th className="py-2 pr-3">Travel</th>
                  <th className="py-2 pr-3">Dry Prob</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {(activePlan?.assignments || []).slice(0, 8).map((a) => (
                  <tr key={a.id} className="hover:bg-stone-50">
                    <td className="py-2.5 pr-3 font-semibold text-[#17211C]">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[10px] mr-1.5">
                        {a.task_code}
                      </span>
                      {a.plot_code} ({a.plot_name})
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-stone-700">
                      {a.crew_code} · {a.crew_name}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-stone-600">
                      Slot {a.start_slot}–{a.end_slot} ({a.duration_minutes}m)
                    </td>
                    <td className="py-2.5 pr-3 text-stone-600">{a.travel_minutes}m</td>
                    <td className="py-2.5 pr-3 font-semibold text-emerald-800">
                      {a.window_probability ? `${(a.window_probability * 100).toFixed(0)}%` : '-'}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          a.frozen
                            ? 'bg-stone-200 text-stone-800'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {a.frozen ? `Frozen (${a.status})` : a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent System Activity Feed */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-700" />
              Recent Audit & Activity Log
            </h3>
            <Link
              to="/notifications"
              className="text-xs font-semibold text-emerald-800 hover:underline"
            >
              View All
            </Link>
          </div>

          <div className="space-y-3 max-h-72 overflow-y-auto">
            {(data.recent_activity || []).map((log: any) => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 text-xs"
              >
                <div className="flex items-center justify-between text-[11px] text-stone-500">
                  <span className="font-mono font-semibold text-emerald-800">{log.action}</span>
                  <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                </div>
                <div className="text-stone-800 font-medium mt-1">{log.summary}</div>
                <div className="text-[10px] text-stone-500 mt-0.5">Actor: {log.user_email}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
