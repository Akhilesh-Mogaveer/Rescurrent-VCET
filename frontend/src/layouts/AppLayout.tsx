import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CalendarClock,
  CloudRain,
  Compass,
  Cpu,
  Database,
  Globe,
  Layers,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Play,
  Scale,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import { t } from '../utils/i18n';

export const AppLayout: React.FC = () => {
  const { user, lang, setLang, logout, toasts, dismissToast, pushToast, unreadCount, refreshNotifications } = useApp();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [runningDemo, setRunningDemo] = useState(false);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t(lang, 'nav_dashboard') },
    { to: '/rain-gap', icon: CloudRain, label: t(lang, 'nav_rain_gap') },
    { to: '/risk-twin', icon: Activity, label: t(lang, 'nav_risk_twin') },
    { to: '/plots', icon: MapPin, label: t(lang, 'nav_plots') },
    { to: '/crews', icon: Users, label: t(lang, 'nav_crews') },
    { to: '/planner', icon: Cpu, label: t(lang, 'nav_planner') },
    { to: '/gantt', icon: CalendarClock, label: t(lang, 'nav_gantt') },
    { to: '/policy-arena', icon: Scale, label: t(lang, 'nav_arena') },
    { to: '/replanning', icon: Compass, label: t(lang, 'nav_replanning') },
    { to: '/assistant', icon: Bot, label: t(lang, 'nav_assistant') },
    { to: '/governance', icon: Database, label: t(lang, 'nav_governance') },
    { to: '/notifications', icon: Bell, label: t(lang, 'nav_notifications'), badge: unreadCount },
    { to: '/settings', icon: SettingsIcon, label: t(lang, 'nav_settings') },
  ];

  const handleOneClickDemo = async () => {
    setRunningDemo(true);
    try {
      const res = await apiRequest('/demo/walkthrough', { method: 'POST' });
      pushToast(
        'End-to-End Demo Executed',
        `Simulation #${res.simulation_run_id} → Baseline Plan #${res.base_plan_id} → Policy Arena #${res.policy_result_id} → Early-Rain Replan #${res.replanned_plan_id} (${res.frozen_count} frozen, ${res.changed_count} updated) in ${res.duration_ms} ms.`,
        'success',
      );
      await refreshNotifications();
      navigate('/replanning');
    } catch (err: any) {
      pushToast('Demo Walkthrough Failed', err.message || 'Error running walkthrough', 'error');
    } finally {
      setRunningDemo(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#F6F5F0] text-[#17211C]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-[#0C1F17] text-emerald-50 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="px-6 py-5 border-b border-emerald-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="font-bold tracking-tight text-lg text-white leading-none">
                MAHALISHIELD
              </div>
              <div className="text-[11px] text-emerald-300/80 mt-1 font-medium">
                {t(lang, 'tagline')}
              </div>
            </div>
          </div>
          <button
            className="lg:hidden text-emerald-300 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* One-Click Demo Button */}
        <div className="px-4 pt-4 pb-2">
          <button
            onClick={handleOneClickDemo}
            disabled={runningDemo}
            className="w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            {runningDemo ? 'Running E2E Pipeline...' : t(lang, 'run_demo')}
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition ${
                    isActive
                      ? 'bg-emerald-700/40 text-white border border-emerald-500/30'
                      : 'text-emerald-100/75 hover:bg-emerald-900/40 hover:text-white'
                  }`
                }
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.badge ? (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500 text-black font-bold">
                    {item.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-4 border-t border-emerald-900/60 bg-[#091812]">
          <div className="flex items-center justify-between">
            <div className="truncate pr-2">
              <div className="text-xs font-semibold text-white truncate">{user?.full_name}</div>
              <div className="text-[11px] text-emerald-400 uppercase tracking-wider font-mono">
                {user?.role}
              </div>
            </div>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              title="Sign Out"
              className="p-2 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-900/50 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200 px-4 lg:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-lg border border-stone-200 text-stone-700"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  Thirthahalli Cluster · Shivamogga, KA
                </span>
                <span className="text-[11px] font-medium text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Layers className="w-3 h-3 text-amber-700" />
                  {t(lang, 'simulated_badge')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Language Switcher (English / Kannada) */}
            <button
              onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
              className="px-3 py-1.5 rounded-lg border border-stone-300 bg-stone-50 hover:bg-stone-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-700" />
              <span>{lang === 'en' ? 'ಕನ್ನಡ (KN)' : 'English (EN)'}</span>
            </button>

            <NavLink
              to="/notifications"
              className="relative p-2 rounded-lg border border-stone-200 hover:bg-stone-100 text-stone-700"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </NavLink>
          </div>
        </header>

        {/* Page Container */}
        <main className="flex-1 p-4 lg:p-8 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Toast Stack */}
      <div className="fixed bottom-5 right-5 z-50 space-y-2 max-w-md w-full pointer-events-none px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border p-4 shadow-lg flex items-start justify-between gap-3 ${
              toast.type === 'error'
                ? 'bg-red-950 text-red-50 border-red-700'
                : toast.type === 'warning'
                ? 'bg-amber-950 text-amber-50 border-amber-700'
                : toast.type === 'success'
                ? 'bg-[#0C1F17] text-emerald-50 border-emerald-600'
                : 'bg-stone-900 text-stone-50 border-stone-700'
            }`}
          >
            <div>
              <div className="text-xs font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {toast.title}
              </div>
              <div className="text-xs opacity-90 mt-1 leading-relaxed">{toast.message}</div>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-xs opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
