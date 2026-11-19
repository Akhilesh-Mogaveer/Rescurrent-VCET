import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import {
  EmptyState,
  InlineError,
  SkeletonBlock,
  SkeletonCard,
  useDelayedLoading,
  useLoadTimeout,
} from '../components/Skeleton';

export const NotificationsPage: React.FC = () => {
  const { pushToast, refreshNotifications } = useApp();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const showSkeleton = useDelayedLoading(loading);
  useLoadTimeout(loading, () => setTimedOut(true), 20000);

  const loadAll = async () => {
    setLoading(true);
    setLoadError(null);
    setTimedOut(false);
    try {
      const [nList, aList] = await Promise.all([
        apiRequest<any[]>('/notifications'),
        apiRequest<any[]>('/activity?limit=60'),
      ]);
      setNotifications(nList);
      setActivity(aList);
      await refreshNotifications();
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load notifications');
      pushToast('Load Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleMarkRead = async (id: number) => {
    try {
      await apiRequest(`/notifications/${id}/read`, { method: 'POST' });
      await loadAll();
    } catch (err: any) {
      pushToast('Error', err.message, 'error');
    }
  };

  if (!notifications.length && !activity.length) {
    if (timedOut || loadError) {
      return (
        <div className="p-6">
          <InlineError
            target="alerts & activity ledger"
            message={timedOut ? 'Request timed out after 20s. Could not load notifications.' : undefined}
            onRetry={loadAll}
          />
        </div>
      );
    }

    if (loading || showSkeleton) {
      return (
        <div aria-busy="true" className="space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-3">
            <SkeletonBlock height={28} width="40%" />
            <SkeletonBlock height={14} width="70%" />
          </div>
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              <SkeletonBlock height={18} width="50%" />
              {[1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} height={80} />
              ))}
            </div>
            <div className="lg:col-span-6 bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              <SkeletonBlock height={18} width="50%" />
              {[1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} height={80} />
              ))}
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
        <h1 className="text-2xl font-bold text-[#17211C]">Notifications & System Audit Ledger</h1>
        <p className="text-xs text-stone-600 mt-1">
          Operational alerts for schedule approvals, rainfall disruptions, crew unavailability,
          equipment failures, and complete system audit history.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Notifications Column */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            Operational Alerts & Notifications ({notifications.length})
          </h2>

          <div className="space-y-3 max-h-[540px] overflow-y-auto">
            {notifications.length === 0 ? (
              <EmptyState message="No unread operational alerts." />
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-4 rounded-xl border text-xs space-y-1.5 ${
                    n.is_read
                      ? 'bg-stone-50 border-stone-200 text-stone-700'
                      : 'bg-emerald-50/70 border-emerald-300 text-[#17211C]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm">{n.title}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        n.severity === 'critical'
                          ? 'bg-red-100 text-red-800'
                          : n.severity === 'warning'
                          ? 'bg-amber-100 text-amber-800'
                          : n.severity === 'success'
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {n.type}
                    </span>
                  </div>
                  <p className="leading-relaxed">{n.message}</p>
                  <div className="flex items-center justify-between pt-2 text-[11px] text-stone-500">
                    <span>{new Date(n.created_at).toLocaleString()}</span>
                    <div className="flex items-center gap-2">
                      {n.link && (
                        <Link
                          to={n.link}
                          className="font-semibold text-emerald-800 hover:underline flex items-center gap-1"
                        >
                          Inspect
                        </Link>
                      )}
                      {!n.is_read && (
                        <button
                          onClick={() => handleMarkRead(n.id)}
                          className="px-2.5 py-1 rounded bg-[#0C1F17] text-white font-semibold flex items-center gap-1 cursor-pointer"
                        > Mark Read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Audit Trail Column */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            Immutable Audit Log ({activity.length} Recent Events)
          </h2>

          <div className="space-y-2.5 max-h-[540px] overflow-y-auto">
            {activity.length === 0 ? (
              <EmptyState message="No audit ledger activity recorded yet." />
            ) : (
              activity.map((a) => (
                <div
                  key={a.id}
                  className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 text-xs"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono font-bold text-emerald-900">
                      {a.action} · {a.entity_type} #{a.entity_id || '-'}
                    </span>
                    <span className="text-stone-500">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="font-medium text-[#17211C] mt-1">{a.summary}</div>
                  <div className="text-[10px] text-stone-500 mt-0.5">Actor: {a.user_email}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
