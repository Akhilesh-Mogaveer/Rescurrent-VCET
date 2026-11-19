import React, { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
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
import { GenericPageSkeleton } from '../components/Skeleton';

export const AppLayout: React.FC = () => {
  const { user, lang, setLang, logout, toasts, dismissToast, pushToast, unreadCount, refreshNotifications } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [runningDemo, setRunningDemo] = useState(false);
  const [plotsCrewsOpen, setPlotsCrewsOpen] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const sidebarRef = useRef<HTMLElement>(null);
  const isDashboard = location.pathname === '/' || location.pathname === '/grower';

  // Post-login full-screen splash: once per session (tracked with sessionStorage)
  const [splashState, setSplashState] = useState<'showing' | 'fading' | 'hidden'>(() => {
    if (!user) return 'hidden';
    const alreadyShown = sessionStorage.getItem('ms_session_splash_shown');
    if (alreadyShown) return 'hidden';
    sessionStorage.setItem('ms_session_splash_shown', 'true');
    return 'showing';
  });
  const [bgImageFailed, setBgImageFailed] = useState(false);

  useEffect(() => {
    if (splashState !== 'showing') return;

    // Show for at least 700ms and at most 3s, then fade out over 300ms
    const timer = setTimeout(() => {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) {
        setSplashState('hidden');
      } else {
        setSplashState('fading');
        setTimeout(() => {
          setSplashState('hidden');
        }, 300);
      }
    }, 1100);

    return () => clearTimeout(timer);
  }, [splashState]);

  const splashImg =
    user?.role === 'farmer'
      ? '/roles/grower.webp'
      : user?.role === 'admin'
      ? '/roles/expert.webp'
      : '/roles/coordinator.webp';

  const splashText =
    user?.role === 'farmer'
      ? 'Loading your farm advisory'
      : user?.role === 'admin'
      ? 'Loading the governance center'
      : 'Loading your command center';

  // Close sidebar on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  // Trap focus inside overlay sidebar while open
  useEffect(() => {
    if (sidebarOpen && sidebarRef.current) {
      const focusable = sidebarRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      }

      const handleTabKey = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        const currentFocusables = sidebarRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!currentFocusables || currentFocusables.length === 0) return;
        const first = currentFocusables[0];
        const last = currentFocusables[currentFocusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      window.addEventListener('keydown', handleTabKey);
      return () => window.removeEventListener('keydown', handleTabKey);
    }
  }, [sidebarOpen]);


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
      {/* Desktop 12px invisible hover strip along left edge */}
      <div
        className="hidden lg:block fixed inset-y-0 left-0 w-3 z-30 pointer-events-auto"
        aria-hidden="true"
        onMouseEnter={() => {
          if (window.matchMedia('(pointer: fine)').matches) {
            setSidebarOpen(true);
          }
        }}
      />

      {/* Semi-transparent dark backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 transition-opacity duration-[240ms]"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar as Fixed Overlay (width 260px, 240ms ease transition, z-50) */}
      <aside
        ref={sidebarRef}
        tabIndex={-1}
        aria-label="Main Navigation"
        onMouseLeave={() => {
          if (window.matchMedia('(pointer: fine)').matches) {
            setSidebarOpen(false);
          }
        }}
        className={`fixed inset-y-0 left-0 z-50 w-[260px] bg-[#0C1F17] text-emerald-50 flex flex-col shadow-2xl transition-transform duration-[240ms] ease-out outline-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
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
            className="text-emerald-300 hover:text-white p-1 rounded-lg"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* One-Click Demo Button - Coordinator & Expert only */}
        {user?.role !== 'farmer' && (
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
        )}

        {/* Nav links */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {user?.role === 'farmer' && (
            <>
              {/* Grower (5 items): My Farm Advisory (/grower), Weather Breaks (/rain-gap), My Plots (/plots), Alerts (/notifications), Settings (/settings) */}
              <NavLink
                to="/grower"
                end
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
                  <LayoutDashboard className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_grower_advisory')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/rain-gap"
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
                  <CloudRain className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_weather_breaks')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/plots"
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
                  <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_my_plots')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/notifications"
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
                  <Bell className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_alerts')}</span>
                </span>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500 text-black font-bold">
                    {unreadCount}
                  </span>
                )}
              </NavLink>

              <NavLink
                to="/settings"
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
                  <SettingsIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_settings')}</span>
                </span>
              </NavLink>
            </>
          )}

          {user?.role === 'coordinator' && (
            <>
              {/* Coordinator (7 top-level items):
                  1. Command Center (/)
                  2. Rain-Gap Twin (/rain-gap)
                  3. Plots & Crews (group: /plots, /crews)
                  4. Schedule (group: /planner, /gantt, /replanning)
                  5. Policy Arena (/policy-arena)
                  6. Intelligence Assistant (/assistant)
                  7. Settings (/settings) */}
              <NavLink
                to="/"
                end
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
                  <LayoutDashboard className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_dashboard')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/rain-gap"
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
                  <CloudRain className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_rain_gap')}</span>
                </span>
              </NavLink>

              {/* Group: Plots & Crews */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setPlotsCrewsOpen(!plotsCrewsOpen)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-emerald-300/80 hover:text-white uppercase tracking-wider transition cursor-pointer"
                >
                  <span>{t(lang, 'nav_plots_crews_group')}</span>
                  {plotsCrewsOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                </button>
                {plotsCrewsOpen && (
                  <div className="space-y-0.5 pl-2 mt-0.5">
                    <NavLink
                      to="/plots"
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                          isActive
                            ? 'bg-emerald-700/40 text-white border border-emerald-500/30'
                            : 'text-emerald-100/75 hover:bg-emerald-900/40 hover:text-white'
                        }`
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{t(lang, 'nav_plots')}</span>
                      </span>
                    </NavLink>
                    <NavLink
                      to="/crews"
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                          isActive
                            ? 'bg-emerald-700/40 text-white border border-emerald-500/30'
                            : 'text-emerald-100/75 hover:bg-emerald-900/40 hover:text-white'
                        }`
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{t(lang, 'nav_crews')}</span>
                      </span>
                    </NavLink>
                  </div>
                )}
              </div>

              {/* Group: Schedule */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setScheduleOpen(!scheduleOpen)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-emerald-300/80 hover:text-white uppercase tracking-wider transition cursor-pointer"
                >
                  <span>{t(lang, 'nav_schedule_group')}</span>
                  {scheduleOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                </button>
                {scheduleOpen && (
                  <div className="space-y-0.5 pl-2 mt-0.5">
                    <NavLink
                      to="/planner"
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                          isActive
                            ? 'bg-emerald-700/40 text-white border border-emerald-500/30'
                            : 'text-emerald-100/75 hover:bg-emerald-900/40 hover:text-white'
                        }`
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{t(lang, 'nav_planner')}</span>
                      </span>
                    </NavLink>
                    <NavLink
                      to="/gantt"
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                          isActive
                            ? 'bg-emerald-700/40 text-white border border-emerald-500/30'
                            : 'text-emerald-100/75 hover:bg-emerald-900/40 hover:text-white'
                        }`
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        <CalendarClock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{t(lang, 'nav_gantt')}</span>
                      </span>
                    </NavLink>
                    <NavLink
                      to="/replanning"
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                          isActive
                            ? 'bg-emerald-700/40 text-white border border-emerald-500/30'
                            : 'text-emerald-100/75 hover:bg-emerald-900/40 hover:text-white'
                        }`
                      }
                    >
                      <span className="flex items-center gap-2.5">
                        <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{t(lang, 'nav_replanning')}</span>
                      </span>
                    </NavLink>
                  </div>
                )}
              </div>

              <NavLink
                to="/policy-arena"
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
                  <Scale className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_arena')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/assistant"
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
                  <Bot className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_assistant')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/settings"
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
                  <SettingsIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_settings')}</span>
                </span>
              </NavLink>
            </>
          )}

          {user?.role === 'admin' && (
            <>
              {/* Expert / Admin (6 items):
                  1. Data & Assumptions (/governance)
                  2. Risk & Protection Twin (/risk-twin)
                  3. Rain-Gap Twin (/rain-gap)
                  4. Policy Arena (/policy-arena)
                  5. Notifications & Audit (/notifications)
                  6. Settings (/settings) */}
              <NavLink
                to="/governance"
                end
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
                  <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_governance')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/risk-twin"
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
                  <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_risk_twin')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/rain-gap"
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
                  <CloudRain className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_rain_gap')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/policy-arena"
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
                  <Scale className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_arena')}</span>
                </span>
              </NavLink>

              <NavLink
                to="/notifications"
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
                  <Bell className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_notifications')}</span>
                </span>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500 text-black font-bold">
                    {unreadCount}
                  </span>
                )}
              </NavLink>

              <NavLink
                to="/settings"
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
                  <SettingsIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t(lang, 'nav_settings')}</span>
                </span>
              </NavLink>
            </>
          )}
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
                sessionStorage.removeItem('ms_session_splash_shown');
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
      <div className="flex-1 flex flex-col min-w-0 w-full">
        {/* Top Header (shown on sub-pages; on dashboard it is integrated into the role image band) */}
        {!isDashboard && (
          <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200 px-4 lg:px-8 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                className="p-2 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-100 transition cursor-pointer"
                onClick={() => setSidebarOpen(true)}
                aria-expanded={sidebarOpen}
                aria-label="Open navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="font-bold tracking-tight text-stone-900 text-sm hidden sm:block">
                MAHALISHIELD
              </div>
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
        )}

        {/* Page Container */}
        <main className={`flex-1 w-full min-w-0 ${!isDashboard ? 'p-4 lg:p-8 max-w-[1600px] mx-auto' : ''}`}>
          <Suspense fallback={<GenericPageSkeleton />}>
            <Outlet context={{ openSidebar: () => setSidebarOpen(true), sidebarOpen }} />
          </Suspense>
        </main>
      </div>

      {/* Post-Login Full-Screen Splash (once per session) */}
      {splashState !== 'hidden' && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Application loading"
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 transition-opacity duration-300 ${
            splashState === 'fading' ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          style={{
            backgroundColor: '#04100a',
            backgroundImage: bgImageFailed
              ? 'linear-gradient(180deg, #04100a 0%, #0c1f17 100%)'
              : `linear-gradient(180deg, rgba(4,16,10,0.85), rgba(4,16,10,0.85)), url('${splashImg}')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <img
            src={splashImg}
            alt=""
            aria-hidden="true"
            className="hidden"
            onError={() => setBgImageFailed(true)}
          />
          <div className="flex flex-col items-center text-center space-y-4 max-w-md">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="font-extrabold tracking-tight text-2xl text-white">
              MAHALISHIELD
            </div>
            <p className="text-sm font-medium text-emerald-100/90 tracking-wide">
              {splashText}
            </p>
          </div>
        </div>
      )}

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
