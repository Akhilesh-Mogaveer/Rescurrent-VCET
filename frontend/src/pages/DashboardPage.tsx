import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
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
import { RoleHeroBand } from '../components/RoleHeroBand';
import {
  ActionStatusLine,
  InlineError,
  SkeletonKpiStrip,
  SkeletonMap,
  SkeletonTable,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

function exposureColor(meanExp: number | undefined): string {
  if (meanExp === undefined) return '#047857';
  if (meanExp >= 18) return '#b91c1c'; // critical relative exposure (danger)
  if (meanExp >= 12) return '#b45309'; // elevated relative exposure (warning)
  if (meanExp >= 7) return '#2563eb'; // moderate
  return '#047857'; // lower (accent)
}

export const DashboardPage: React.FC = () => {
  const { user, lang, pushToast } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [selectedPlotId, setSelectedPlotId] = useState<number | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);
  const [showAllFactors, setShowAllFactors] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Long-running optimizer state
  const [optimizing, setOptimizing] = useState(false);
  const [optDone, setOptDone] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const loadDashboard = async () => {
    setLoading(true);
    setTimedOut(false);
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

  const handleRunOptimizer = async () => {
    setOptimizing(true);
    setOptDone(false);
    setOptError(null);
    try {
      const res = await apiRequest<PlanItem>('/plans/optimize', {
        method: 'POST',
        body: JSON.stringify({ policy: 'optimized', time_limit_s: 10, seed: 42 }),
      });
      cacheApprovedPlan(res);
      setOptDone(true);
      await loadDashboard();
      setTimeout(() => setOptDone(false), 2500);
      pushToast(
        'Optimization Complete',
        `Plan #${res.id} solved in ${res.solver?.solve_time_s ?? 1}s`,
        'success',
      );
    } catch (err: any) {
      setOptError(err.message || 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  // Reveal sections below the hero on scroll
  useEffect(() => {
    if (loading || !data) return;
    const elements = document.querySelectorAll('.dashboard-reveal-section');
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight) {
        el.classList.add('is-revealed');
      } else {
        observer.observe(el);
      }
    });

    return () => observer.disconnect();
  }, [loading, data]);

  const plots: PlotItem[] = data?.plots || [];
  const queue: PriorityQueueItem[] = data?.priority_queue || [];
  const activePlan: PlanItem | null = data?.active_plan || getCachedApprovedPlan()?.plan || null;
  const nextWindow = data?.weather?.next_dry_window;
  const selectedPlot = plots.find((p) => p.id === selectedPlotId) || plots[0];
  const selectedQueueItem = queue.find((q) => q.plot_id === selectedPlot?.id);

  const roleImage =
    user?.role === 'farmer'
      ? '/page_img/farmer.png'
      : user?.role === 'admin'
      ? '/page_img/admin.png'
      : '/page_img/coordinator.png';

  const roleLabel =
    user?.role === 'farmer'
      ? t(lang, 'role_farmer')
      : user?.role === 'admin'
      ? t(lang, 'role_admin')
      : t(lang, 'role_coordinator');

  const heroTitle =
    user?.role === 'farmer'
      ? t(lang, 'dashboard_title_farmer')
      : user?.role === 'admin'
      ? t(lang, 'dashboard_title_admin')
      : t(lang, 'dashboard_title_coordinator');

  const heroActions = (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        onClick={handleRunOptimizer}
        disabled={optimizing}
        className="px-4 py-2 rounded-[6px] bg-[#047857] hover:bg-[#065f46] text-white font-semibold text-sm flex items-center gap-2 transition cursor-pointer shrink-0 disabled:opacity-50"
      >
        Run CP-SAT Optimizer
      </button>
      <button
        type="button"
        onClick={loadDashboard}
        aria-label="Refresh data"
        title="Refresh data"
        className="p-2 rounded-[6px] border border-white/25 bg-[rgba(4,16,10,0.55)] hover:bg-[rgba(4,16,10,0.85)] text-white transition cursor-pointer flex items-center justify-center shrink-0"
      >
      </button>
      <ActionStatusLine
        isRunning={optimizing}
        actionName="Optimizing"
        timeLimit={10}
        isDone={optDone}
        error={optError}
        onRetry={handleRunOptimizer}
        className="text-white bg-black/40 px-2.5 py-1 rounded-[6px] border border-white/10"
      />
    </div>
  );

  return (
    <div className="w-full">
      {/* Upgraded Role Hero Band (Renders immediately, never blocked behind data loads) */}
      <RoleHeroBand
        roleImage={roleImage}
        roleLabel={roleLabel}
        heroTitle={heroTitle}
        actions={heroActions}
        offlineMode={offlineMode}
        showCluster={user?.role === 'coordinator' || user?.role === 'farmer'}
      />

      {/* Main Dashboard Content Area: 24px padding and 24px spacing between sections */}
      <div className="p-6 max-w-[1600px] w-full mx-auto space-y-6">
        {/* Error / Timeout State if no data available */}
        {!data && (timedOut || (!loading && !data)) && (
          <InlineError
            target="Command Center data"
            message={timedOut ? 'Request timed out after 20s. Could not load Command Center data.' : undefined}
            onRetry={loadDashboard}
          />
        )}

        {/* Skeleton State when loading and data is not yet ready */}
        {!data && (loading || showSkeleton) && !timedOut && (
          <div aria-busy="true" className="space-y-6">
            <div className="relative z-20">
              <SkeletonKpiStrip />
            </div>
            <div className="grid lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7">
                <SkeletonMap height={380} />
              </div>
              <div className="lg:col-span-5">
                <SkeletonTable rows={5} cols={4} />
              </div>
            </div>
            <SkeletonTable rows={3} cols={5} />
          </div>
        )}

        {/* Real Content once data is ready */}
        {data && (
          <>
            {/* KPI Metrics Strip - Positioned cleanly below hero image */}
            <div className="relative z-20">
              <div className="kpi-strip border border-[#e5e7eb] bg-white shadow-none">
                <div className="kpi-strip-item">
                  <div className="kpi-strip-label">Monitored plots</div>
                  <div className="kpi-strip-value text-[#111827]">
                    {data.counts.total_plots}
                  </div>
                  <div className="kpi-strip-detail">
                    {data.counts.total_farms} farms · {data.counts.total_acres} ac
                  </div>
                </div>

                <div className="kpi-strip-item">
                  <div className="kpi-strip-label">Available crews</div>
                  <div className="kpi-strip-value text-[#111827]">
                    {data.counts.active_crews}/{data.counts.total_crews}
                  </div>
                  <div className="kpi-strip-detail">
                    {data.counts.operational_equipment} equipment units
                  </div>
                </div>

                <a
                  href="#priority-queue"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('priority-queue')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="kpi-strip-item kpi-strip-link"
                >
                  <div className="kpi-strip-label">Plots requiring attention</div>
                  <div className="kpi-strip-value text-[#b45309]">
                    {data.counts.plots_requiring_attention}
                  </div>
                  <div className="kpi-strip-detail">
                    {data.counts.pending_operations} pending operations
                  </div>
                </a>

                <div className="kpi-strip-item kpi-strip-item-dry">
                  <div className="kpi-strip-label">Next dry window</div>
                  <div className="kpi-strip-value text-[#047857]">
                    {nextWindow ? `+${nextWindow.start_hour}h to +${nextWindow.end_hour}h` : 'None ≥60%'}
                  </div>
                  <div className="kpi-strip-detail">
                    {nextWindow
                      ? `Peak dry probability ${(nextWindow.max_probability * 100).toFixed(0)}% · rain return ${(nextWindow.rain_return_risk_at_best * 100).toFixed(0)}%`
                      : 'Wait for forecast break'}
                  </div>
                </div>
              </div>
            </div>



        {/* Interactive Geospatial Map + Risk Priority Queue */}
        <div className="grid lg:grid-cols-12 gap-6 items-stretch dashboard-reveal-section">
          {/* Map Column */}
          <div className="lg:col-span-7 bg-white rounded-[6px] border border-[#e5e7eb] overflow-hidden flex flex-col justify-between">
            <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold text-[#111827]">
                  Cluster Geospatial Exposure Map
                </h2>
                <p className="text-sm text-[#6b7280] mt-0.5">
                  Click any plot marker to inspect relative simulated exposure, protection state, and assigned crew.
                </p>
              </div>
              {/* Accessible Compact Legend */}
              <div className="flex items-center gap-3 text-xs text-[#6b7280] flex-wrap">
                <span className="font-medium text-[#111827]">Exposure:</span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#b91c1c] inline-block" /> Critical (≥18)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#b45309] inline-block" /> Elevated (12–18)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#2563eb] inline-block" /> Moderate (7–12)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#047857] inline-block" /> Lower (&lt;7)
                </span>
              </div>
            </div>

            <div className="command-center-map h-[420px] w-full relative">
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
                        click: () => {
                          setSelectedPlotId(plot.id);
                          setShowAllFactors(false);
                        },
                      }}
                    >
                      <Popup>
                        <div className="text-sm space-y-1">
                          <div className="font-semibold text-base text-[#111827]">
                            {plot.code} — {plot.name}
                          </div>
                          <div className="text-[#6b7280]">
                            Farm: {plot.farm_name} ({plot.area_acres} ac)
                          </div>
                          <div className="text-xs text-[#111827]">
                            Priority: <span className="capitalize font-medium">{plot.priority}</span> · Drainage: <span className="capitalize font-medium">{plot.drainage}</span>
                          </div>
                          <div className="text-xs text-[#111827]">
                            Relative Exposure: <strong>{exp !== undefined ? `${exp.toFixed(2)} index-h` : 'N/A'}</strong>
                          </div>
                          <div className="text-xs text-[#111827]">
                            Protection: <strong>{(plot.protection_state * 100).toFixed(0)}%</strong>
                          </div>
                          <div className="text-xs text-[#111827]">
                            Assigned Crew: <strong>{plot.assigned_crew_code || 'Pending assignment'}</strong>
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>

            {/* Selected Plot Inspector Bar Restyled with Tokens */}
            {selectedPlot && (
              <div className="p-4 bg-white border-t border-[#e5e7eb] flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[#111827]">
                    Selected: {selectedPlot.code} — {selectedPlot.name} ({selectedPlot.area_acres} ac ·{' '}
                    <span className="capitalize font-normal text-[#6b7280]">{selectedPlot.priority}</span>)
                  </div>
                  <div className="text-xs text-[#6b7280] mt-1.5">
                    <span className="font-medium text-[#111827]">Why prioritized:</span>
                    {(() => {
                      const allFactors = (selectedQueueItem?.factors && selectedQueueItem.factors.length > 0)
                        ? selectedQueueItem.factors
                        : ['Combined wetness and low protection state'];
                      const visibleFactors = showAllFactors ? allFactors : allFactors.slice(0, 3);
                      return (
                        <div className="mt-0.5 space-y-0.5">
                          {visibleFactors.map((reason, idx) => (
                            <div key={idx} className="line-clamp-1">
                              • {reason}
                            </div>
                          ))}
                          {allFactors.length > 3 && (
                            <button
                              type="button"
                              onClick={() => setShowAllFactors(!showAllFactors)}
                              className="mt-1 text-xs font-semibold text-[#047857] hover:underline cursor-pointer inline-block"
                            >
                              {showAllFactors ? 'Less' : `More (${allFactors.length - 3} more)`}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <Link
                  to="/risk-twin"
                  className="px-3 py-1.5 rounded-[6px] border border-[#e5e7eb] bg-white hover:bg-[#f9fafb] text-xs font-semibold text-[#111827] shrink-0 flex items-center gap-1 transition self-start sm:self-center"
                >
                  Inspect Twin
                </Link>
              </div>
            )}
          </div>

          {/* Priority Queue Column as a Table */}
          <div
            id="priority-queue"
            className="lg:col-span-5 bg-white rounded-[6px] border border-[#e5e7eb] flex flex-col overflow-hidden"
          >
            <div className="p-4 border-b border-[#e5e7eb]">
              <h2 className="text-base font-semibold text-[#111827]">
                Simulated Exposure Priority Queue
              </h2>
              <p className="text-sm text-[#6b7280] mt-0.5">
                Ranked by expected weighted relative exposure across scenarios.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[490px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="sticky top-0 bg-white z-10 border-b border-[#e5e7eb] text-xs font-medium text-[#6b7280]">
                    <th className="py-2.5 px-3 w-10 text-center font-medium">Rank</th>
                    <th className="py-2.5 px-3 font-medium">Plot</th>
                    <th className="py-2.5 px-2 font-medium">Area</th>
                    <th className="py-2.5 px-2 font-medium">Priority</th>
                    <th className="py-2.5 px-2 text-right font-medium">Score</th>
                    <th className="py-2.5 px-3 text-right font-medium">Mean / P90 (wet h)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb]">
                  {queue.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-sm text-[#6b7280]">
                        {t(lang, 'no_plots_need_attention')}
                      </td>
                    </tr>
                  ) : (
                    queue.map((item) => {
                      const plot = plots.find((p) => p.id === item.plot_id);
                      const isSelected = selectedPlot?.id === item.plot_id;
                      const urgencyDot =
                        plot?.priority === 'urgent'
                          ? 'bg-[#b91c1c]'
                          : plot?.priority === 'high'
                          ? 'bg-[#b45309]'
                          : plot?.priority === 'medium'
                          ? 'bg-[#2563eb]'
                          : 'bg-[#047857]';

                      return (
                        <tr
                          key={item.plot_id}
                          aria-selected={isSelected}
                          tabIndex={0}
                          onClick={() => {
                            setSelectedPlotId(item.plot_id);
                            setShowAllFactors(false);
                            const matchingAssignment = (activePlan?.assignments || []).find(
                              (a) => a.plot_id === item.plot_id,
                            );
                            if (matchingAssignment) setSelectedAssignmentId(matchingAssignment.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedPlotId(item.plot_id);
                              setShowAllFactors(false);
                              const matchingAssignment = (activePlan?.assignments || []).find(
                                (a) => a.plot_id === item.plot_id,
                              );
                              if (matchingAssignment) setSelectedAssignmentId(matchingAssignment.id);
                            }
                          }}
                          className={`hover:bg-[#f9fafb] transition cursor-pointer focus:outline-none focus:bg-[#f9fafb] ${
                            isSelected ? 'bg-[#f0fdf4]' : ''
                          }`}
                        >
                        <td className="py-3 px-3 text-center text-xs tabular-nums text-[#6b7280] font-medium">
                          {item.rank}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-sm text-[#111827]">
                            {item.code} — {plot?.name || item.code}
                          </div>
                          <div
                            className="text-xs text-[#6b7280] line-clamp-2 mt-0.5"
                            title={(item.factors || []).join(' · ')}
                          >
                            {(item.factors || []).join(' · ')}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-xs text-[#111827] tabular-nums whitespace-nowrap">
                          {plot?.area_acres ?? '-'} ac
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-[6px] text-xs text-[#111827] capitalize">
                            <span className={`w-[8px] h-[8px] rounded-full shrink-0 ${urgencyDot}`} />
                            {plot?.priority || 'normal'}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right font-semibold text-xs text-[#111827] tabular-nums">
                          {item.score.toFixed(1)}
                        </td>
                        <td className="py-3 px-3 text-right text-xs text-[#6b7280] tabular-nums whitespace-nowrap">
                          {item.exposure_hours_mean.toFixed(1)} / {item.exposure_hours_p90.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Bottom Section: Upcoming Operational Tasks as a Table */}
        <div className="bg-white rounded-[6px] border border-[#e5e7eb] p-4 space-y-4 dashboard-reveal-section">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-base font-semibold text-[#111827]">
                Upcoming Scheduled Operations (Plan #{activePlan?.id || '-'})
              </h3>
              <p className="text-sm text-[#6b7280] mt-0.5">
                Validated crew-to-plot assignments respecting shift hours, travel buffers, and sprayer capacity.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <Link
                to="/replanning"
                className="px-3.5 py-1.5 rounded-[6px] border border-[#e5e7eb] bg-white hover:bg-[#f9fafb] text-[#111827] font-semibold text-xs transition cursor-pointer inline-flex items-center"
              >
                Dynamic Replanning
              </Link>
              <Link
                to="/gantt"
                className="text-sm font-medium text-[#047857] hover:underline flex items-center gap-1"
              >
                View full schedule
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e5e7eb] text-xs font-medium text-[#6b7280]">
                  <th className="py-2.5 pr-3 font-medium">Task / Plot</th>
                  <th className="py-2.5 pr-3 font-medium">Crew</th>
                  <th className="py-2.5 pr-3 font-medium">Window</th>
                  <th className="py-2.5 pr-3 font-medium">Travel</th>
                  <th className="py-2.5 pr-3 font-medium">Dry prob</th>
                  <th className="py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb]">
                {(activePlan?.assignments || []).slice(0, 3).map((a) => {
                  const isSelected = selectedAssignmentId === a.id || selectedPlot?.id === a.plot_id;
                  return (
                    <tr
                      key={a.id}
                      aria-selected={isSelected}
                      tabIndex={0}
                      onClick={() => {
                        setSelectedAssignmentId(a.id);
                        if (a.plot_id) setSelectedPlotId(a.plot_id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedAssignmentId(a.id);
                          if (a.plot_id) setSelectedPlotId(a.plot_id);
                        }
                      }}
                      className={`hover:bg-[#f9fafb] transition cursor-pointer focus:outline-none focus:bg-[#f9fafb] ${
                        isSelected ? 'bg-[#f0fdf4]' : ''
                      }`}
                    >
                      <td className="py-3 pr-3 font-medium text-[#111827]">
                        <span className="font-mono text-xs text-[#6b7280] mr-2">
                          {a.task_code}
                        </span>
                        {a.plot_code} ({a.plot_name})
                      </td>
                      <td className="py-3 pr-3 text-[#111827]">
                        {a.crew_code} · {a.crew_name}
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs text-[#6b7280]">
                        Slot {a.start_slot}–{a.end_slot} ({a.duration_minutes}m)
                      </td>
                      <td className="py-3 pr-3 text-[#6b7280]">{a.travel_minutes}m</td>
                      <td className="py-3 pr-3 font-semibold text-[#047857]">
                        {a.window_probability ? `${(a.window_probability * 100).toFixed(0)}%` : '-'}
                      </td>
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-[#111827]">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              a.frozen ? 'bg-[#6b7280]' : 'bg-[#047857]'
                            }`}
                          />
                          {a.frozen ? `Frozen (${a.status})` : a.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )}
  </div>
</div>
);
};
