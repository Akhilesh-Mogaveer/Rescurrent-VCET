import React from 'react';
import type { PlanItem, PlotItem, PriorityQueueItem } from '../types';
import { t } from '../utils/i18n';
import { useApp } from '../context/AppContext';

interface GrowerAdvisorySectionProps {
  data: any;
  selectedPlot?: PlotItem;
  selectedQueueItem?: PriorityQueueItem;
  activePlan?: PlanItem | null;
}

export const GrowerAdvisorySection: React.FC<GrowerAdvisorySectionProps> = ({
  data,
  selectedPlot,
  selectedQueueItem,
  activePlan,
}) => {
  const { lang } = useApp();

  return (
    <div className="bg-emerald-950 text-emerald-50 rounded-2xl p-6 border border-emerald-700 space-y-4 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
            {t(lang, 'farmer_portal_title')}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
            {t(lang, 'next_approved_plan')} & {t(lang, 'why_prioritized')}
          </h2>
        </div>
        <span className="text-xs px-3 py-1 rounded-full bg-emerald-800 text-emerald-200 font-mono">
          {t(lang, 'offline_cached')}
        </span>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Sub-card 1: Upcoming Windows */}
        <div className="p-4 rounded-xl bg-emerald-900/60 border border-emerald-700/60 flex flex-col justify-between">
          <div className="text-sm font-semibold text-emerald-300">
            {t(lang, 'upcoming_windows')}
          </div>
          <div className="mt-2 space-y-2.5">
            {(data?.weather?.windows || []).slice(0, 2).map((w: any, idx: number) => (
              <div key={idx} className="text-sm border-t border-emerald-800/80 pt-2">
                <div className="font-bold text-white text-base">
                  Window {idx + 1}: +{w.start_hour}h to +{w.end_hour}h
                </div>
                <div className="text-emerald-200/80 text-xs mt-0.5">
                  Dry probability: {(w.max_probability * 100).toFixed(0)}% · Rain return:{' '}
                  {(w.rain_return_risk_at_best * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sub-card 2: Highest-Attention Plot */}
        <div className="p-4 rounded-xl bg-emerald-900/60 border border-emerald-700/60 flex flex-col justify-between">
          <div className="text-sm font-semibold text-emerald-300">
            Your Highest-Attention Plot: {selectedPlot?.code || 'None'} ({selectedPlot?.name || 'All plots protected'})
          </div>
          <div className="text-sm text-emerald-100 mt-2 space-y-1.5">
            <div>
              Priority: <strong className="uppercase">{selectedPlot?.priority || '-'}</strong> · Area:{' '}
              <strong>{selectedPlot?.area_acres || 0} acres</strong>
            </div>
            <div>
              Simulated Exposure:{' '}
              <strong>
                {selectedPlot?.simulated_exposure?.exposure_hours_mean?.toFixed(2) || '-'} index-h
              </strong>
            </div>
            <div className="text-emerald-200/90 text-xs mt-1">
              Reasons: {(selectedQueueItem?.factors || ['Combined wetness risk']).join('; ')}
            </div>
          </div>
        </div>

        {/* Sub-card 3: Next Approved Plan */}
        <div className="p-4 rounded-xl bg-emerald-900/60 border border-emerald-700/60 flex flex-col justify-between">
          <div className="text-sm font-semibold text-emerald-300">
            {t(lang, 'next_approved_plan')}
          </div>
          {activePlan?.assignments && activePlan.assignments.length > 0 ? (
            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto text-sm">
              {activePlan.assignments.slice(0, 4).map((a) => (
                <div
                  key={a.id}
                  className="p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-800 flex items-center justify-between text-xs"
                >
                  <span>
                    <strong className="text-white text-sm">{a.plot_code}</strong> ({a.task_code})
                  </span>
                  <span className="font-mono text-emerald-300">
                    Slot {a.start_slot}–{a.end_slot}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-emerald-200/90 mt-2">No approved assignments yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};
