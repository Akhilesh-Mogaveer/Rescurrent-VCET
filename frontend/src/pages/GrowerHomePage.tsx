import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { GrowerAdvisorySection } from '../components/GrowerAdvisorySection';
import { RoleHeroBand } from '../components/RoleHeroBand';
import {
  EmptyState,
  InlineError,
  SkeletonCard,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

export const GrowerHomePage: React.FC = () => {
  const { user, lang } = useApp();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const loadGrowerData = async () => {
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
    } catch {
      const cached = getCachedDashboardSummary();
      if (cached) {
        setData(cached.summary);
        setOfflineMode(true);
      }
      const cachedPlan = getCachedApprovedPlan();
      if (cachedPlan && (!data || !data.active_plan)) {
        setData((prev: any) => ({ ...prev, active_plan: cachedPlan.plan }));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGrowerData();
  }, []);

  const activePlan: PlanItem | null = data?.active_plan || null;
  const allPlots: PlotItem[] = data?.plots || [];
  const priorityQueue: PriorityQueueItem[] = data?.priority_queue || [];

  // Filter plots by logged in grower name if available, fallback to all plots
  const myPlots = allPlots.filter((p) => {
    if (!user?.full_name) return true;
    if (p.grower_name) {
      const pName = p.grower_name.toLowerCase();
      const uName = user.full_name.toLowerCase();
      return pName.includes(uName) || uName.includes(pName);
    }
    return true;
  });

  const displayPlots = myPlots.length > 0 ? myPlots : allPlots;

  // Find highest attention plot
  const topQueueItem = priorityQueue.find((q) =>
    displayPlots.some((p) => p.id === q.plot_id || p.code === q.code)
  ) || priorityQueue[0];

  const highestAttentionPlot = displayPlots.find(
    (p) => p.id === topQueueItem?.plot_id || p.code === topQueueItem?.code
  ) || displayPlots[0];

  // Dry windows
  const nextWindow = (data?.weather?.windows || [])[0];

  // Helper to get scheduled status for a plot
  const getPlotScheduleStatus = (plot: PlotItem) => {
    if (!activePlan?.assignments) return { status: 'none', label: t(lang, 'not_scheduled') };
    const assignment = activePlan.assignments.find(
      (a) => a.plot_id === plot.id || a.plot_code === plot.code
    );
    if (!assignment) {
      return { status: 'none', label: t(lang, 'not_scheduled') };
    }
    if (assignment.start_slot < 96) {
      return { status: 'today', label: t(lang, 'scheduled_today'), assignment };
    } else if (assignment.start_slot < 192) {
      return { status: 'tomorrow', label: t(lang, 'scheduled_tomorrow'), assignment };
    }
    return { status: 'upcoming', label: 'Scheduled', assignment };
  };

  // Helper to format operation time cleanly without slots or codes
  const formatOperationTime = (isoString?: string, startSlot?: number) => {
    if (isoString) {
      try {
        const d = new Date(isoString);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        // fallback
      }
    }
    if (startSlot !== undefined) {
      const totalMinutes = startSlot * 15;
      const hours = Math.floor(totalMinutes / 60) % 24;
      const mins = totalMinutes % 60;
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 === 0 ? 12 : hours % 12;
      return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
    }
    return '';
  };

  // Human-readable task name
  const formatTaskName = (taskCode: string) => {
    if (taskCode === 'SPRAY_BORDEAUX_1') return 'Bordeaux Mixture 1% Protective Spray';
    if (taskCode === 'HARVEST_SANITATION') return 'Phytosanitary Harvest & Nut Collection';
    if (taskCode === 'DRAINAGE_CLEAR') return 'Drainage & Basin Clear Operation';
    return taskCode.replace(/_/g, ' ');
  };

  // Gather upcoming operations for display plots
  const upcomingOperations = (activePlan?.assignments || [])
    .filter((a) => displayPlots.some((p) => p.id === a.plot_id || p.code === a.plot_code))
    .slice(0, 5);

  return (
    <div className="w-full pb-16">
      {/* Upgraded Role Hero Band */}
      <RoleHeroBand
        roleImage="/page_img/farmer.png"
        roleLabel={t(lang, 'role_farmer')}
        heroTitle={t(lang, 'dashboard_title_farmer')}
        subtitle="Rain-aware advisory and protection schedule for your arecanut plots."
        offlineMode={offlineMode}
        showCluster
      />

      {/* Single-Column Mobile-First Container (max-w-xl) */}
      <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
        {/* Error / Timeout State */}
        {!data && (timedOut || (!loading && !data)) && (
          <InlineError
            target="farm advisory data"
            message={timedOut ? 'Request timed out after 20s. Could not load advisory data.' : undefined}
            onRetry={loadGrowerData}
          />
        )}

        {/* Skeleton State when loading */}
        {!data && (loading || showSkeleton) && !timedOut && (
          <div aria-busy="true" className="space-y-6">
            <SkeletonCard height={140} />
            <SkeletonCard height={200} />
            <SkeletonCard height={180} />
            <SkeletonCard height={160} />
          </div>
        )}

        {data && (
          <>
            {/* 1. Next Dry Spray Window - Large, Clear, Prominent */}
            <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  {t(lang, 'next_dry_window_title')}
                </span>
                <span className="text-xs text-stone-500 flex items-center gap-1">
                  48-Hour Forecast
                </span>
              </div>

              {nextWindow ? (
                <div>
                  <div className="flex items-baseline gap-2">
                    <div>
                      <div className="text-2xl sm:text-3xl font-extrabold text-stone-900 leading-tight">
                        {nextWindow.start_hour === 0
                          ? 'Spray window open now'
                          : `Opens in ${nextWindow.start_hour} hour${nextWindow.start_hour > 1 ? 's' : ''}`}
                      </div>
                      <div className="text-sm sm:text-base text-stone-600 font-medium mt-1">
                        +{nextWindow.start_hour}h to +{nextWindow.end_hour}h ({nextWindow.end_hour - nextWindow.start_hour} hour dry gap)
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-stone-100 text-base">
                    <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                      <div className="text-xs text-stone-500">Dry Probability</div>
                      <div className="text-xl font-bold text-emerald-700 mt-0.5">
                        {(nextWindow.max_probability * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                      <div className="text-xs text-stone-500">Rain Return Risk</div>
                      <div className="text-xl font-bold text-amber-700 mt-0.5">
                        {(nextWindow.rain_return_risk_at_best * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center text-stone-600 text-base">
                  <div className="font-semibold">Persistent Rainfall Expected</div>
                  <div className="text-sm text-stone-500 mt-1">
                    No safe dry spray window detected in the immediate forecast.
                  </div>
                </div>
              )}
            </div>

            {/* 2. Grower Advisory Section (Extracted Component) */}
            <GrowerAdvisorySection
              data={data}
              selectedPlot={highestAttentionPlot}
              selectedQueueItem={topQueueItem}
              activePlan={activePlan}
            />

            {/* 3. My Plots List */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-stone-900">
                    {t(lang, 'my_plots_title')}
                  </h2>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {displayPlots.length} plot{displayPlots.length > 1 ? 's' : ''} under active monitoring
                  </p>
                </div>
                <Link
                  to="/plots"
                  className="min-h-[44px] px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 rounded-lg flex items-center gap-1 transition"
                >
                  View Details &rarr;
                </Link>
              </div>

              <div className="divide-y divide-stone-100">
                {displayPlots.map((plot) => {
                  const schedule = getPlotScheduleStatus(plot);
                  const isScheduledToday = schedule.status === 'today';
                  const isScheduledTomorrow = schedule.status === 'tomorrow';

                  return (
                    <div key={plot.id} className="py-3.5 flex items-center justify-between gap-3 text-base">
                      <div className="min-w-0">
                        <div className="font-bold text-stone-900 truncate">
                          {plot.name} <span className="text-stone-400 font-mono text-xs">({plot.code})</span>
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{plot.area_acres} acres</span>
                          <span>·</span>
                          <span className="capitalize">
                            Priority: <strong>{plot.priority}</strong>
                          </span>
                          <span>·</span>
                          <span>Protection: {Math.round((plot.protection_state || 0) * 100)}%</span>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <span
                          className={`inline-block px-3 py-1.5 rounded-full text-xs font-semibold ${
                            isScheduledToday
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : isScheduledTomorrow
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : 'bg-stone-100 text-stone-600 border border-stone-200'
                          }`}
                        >
                          {schedule.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 4. Upcoming Operations for My Plots */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 sm:p-6 space-y-4">
              <h2 className="text-lg font-bold text-stone-900">
                {t(lang, 'my_operations_title')}
              </h2>

              {upcomingOperations.length > 0 ? (
                <div className="space-y-3">
                  {upcomingOperations.map((op) => {
                    const plot = displayPlots.find((p) => p.id === op.plot_id || p.code === op.plot_code);
                    const isToday = op.start_slot < 96;
                    const dayLabel = isToday ? 'Today' : 'Tomorrow';
                    const timeRange = `${formatOperationTime(op.start_time, op.start_slot)} – ${formatOperationTime(
                      op.end_time,
                      op.end_slot
                    )}`;

                    return (
                      <div
                        key={op.id}
                        className="p-4 rounded-xl border border-stone-200 bg-stone-50/70 hover:bg-stone-50 transition"
                      >
                        <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
                          <span className="font-semibold text-emerald-800 flex items-center gap-1">
                            {dayLabel}
                          </span>
                          <span>{timeRange}</span>
                        </div>
                        <div className="font-bold text-stone-900 text-base">
                          {formatTaskName(op.task_code)}
                        </div>
                        <div className="text-xs text-stone-600 mt-1 flex items-center gap-1.5">
                          <span>
                            Target: <strong>{plot?.name || op.plot_name || op.plot_code}</strong> ({plot?.area_acres || op.plot_area_acres} acres)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No operations scheduled yet." />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
