import React, { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Bell, Globe, Layers, Menu, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { t } from '../utils/i18n';

interface RoleHeroBandProps {
  roleImage: string;
  roleLabel: string;
  heroTitle: string;
  subtitle?: string;
  actions?: React.ReactNode;
  offlineMode?: boolean;
}

export const RoleHeroBand: React.FC<RoleHeroBandProps> = ({
  roleImage,
  roleLabel,
  heroTitle,
  subtitle,
  actions,
  offlineMode,
}) => {
  const { lang, setLang, unreadCount } = useApp();
  const outlet = useOutletContext<{ openSidebar?: () => void; sidebarOpen?: boolean }>() || {};
  const openSidebar = outlet.openSidebar;
  const sidebarOpen = outlet.sidebarOpen;

  const heroRef = useRef<HTMLDivElement>(null);
  const parallaxRef = useRef<HTMLDivElement>(null);
  const [heroInView, setHeroInView] = useState(true);

  // IntersectionObserver on hero for sticky top bar
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeroInView(entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Parallax: 0.4x scroll offset fallback using passive listener & requestAnimationFrame
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (CSS.supports && CSS.supports('animation-timeline', 'scroll()')) {
      return; // Handled by CSS
    }

    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const scrollY = window.scrollY;
        if (scrollY < 600 && parallaxRef.current) {
          parallaxRef.current.style.transform = `translate3d(0, ${Math.round(scrollY * 0.4)}px, 0)`;
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <>
      {/* 1. Full-Width Role Hero Band */}
      <div
        ref={heroRef}
        className="role-hero-wrapper relative w-full overflow-hidden select-none"
        style={{ height: 'clamp(360px, 50vh, 520px)' }}
      >
        {/* Parallax & Zoom Image Layer */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            ref={parallaxRef}
            className="hero-parallax-scroll absolute inset-0 w-full h-full will-change-transform"
          >
            <img
              src={roleImage}
              alt=""
              aria-hidden="true"
              loading="eager"
              fetchPriority="high"
              className="hero-zoom-img absolute inset-0 w-full h-full object-cover object-right"
            />
          </div>
        </div>

        {/* Dark Left-to-Right & Top Gradients */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(4, 16, 10, 0.65) 0%, transparent 80px), linear-gradient(90deg, rgba(4, 16, 10, 0.94) 0%, rgba(4, 16, 10, 0.76) 52%, rgba(4, 16, 10, 0.15) 88%)',
          }}
        />

        {/* Content Container */}
        <div className="relative z-10 h-full flex flex-col justify-between text-white">
          {/* Top Row: Hamburger, Wordmark, Cluster Pill, Disclaimer Pill, Language, Bell */}
          <div className="px-4 sm:px-6 lg:px-8 pt-3.5 sm:pt-4">
            <div className="flex items-center justify-between gap-3">
              {/* Left Group */}
              <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
                <button
                  onClick={openSidebar}
                  aria-expanded={sidebarOpen}
                  aria-label="Open navigation"
                  className="role-top-pill p-2 rounded-[6px] hover:bg-[rgba(4,16,10,0.85)] transition cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Menu className="w-5 h-5 text-white" />
                </button>

                <div className="font-bold tracking-tight text-base sm:text-lg text-white leading-none shrink-0">
                  MAHALISHIELD
                </div>

                <div className="hidden sm:flex items-center gap-2">
                  <span className="role-top-pill text-xs font-medium px-2.5 py-1 rounded-[6px] text-emerald-100 whitespace-nowrap">
                    Thirthahalli Cluster · Shivamogga, KA
                  </span>
                  {/* Disclaimer pill on >=768px (MD) in top row */}
                  <span className="hidden md:inline-flex role-top-pill text-xs font-medium text-amber-200 px-2.5 py-1 rounded-[6px] items-center gap-1.5 shrink-0">
                    <Layers className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    {/* <span>{t(lang, 'simulated_badge')}</span> */}
                  </span>
                </div>
              </div>

              {/* Right Group: Language & Bell */}
              <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                <button
                  onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
                  className="role-top-pill px-3 py-1.5 rounded-[6px] text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-[rgba(4,16,10,0.85)] transition"
                >
                  <Globe className="w-3.5 h-3.5 text-emerald-300" />
                  <span>{lang === 'en' ? 'ಕನ್ನಡ (KN)' : 'English (EN)'}</span>
                </button>

                <Link
                  to="/notifications"
                  className="role-top-pill relative p-2 rounded-[6px] hover:bg-[rgba(4,16,10,0.85)] transition flex items-center justify-center"
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4 text-white" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </Link>
              </div>
            </div>
          </div>

          {/* Under 768px: Full-Width Thin Disclaimer Strip (28px) Directly Below Top Row */}
          <div className="md:hidden w-full h-[28px] bg-amber-950/90 border-y border-amber-500/40 text-amber-300 text-[11px] font-semibold flex items-center justify-center gap-1.5 px-3 shrink-0">
            <Layers className="w-3 h-3 text-amber-300 shrink-0" />
            <span className="truncate">{t(lang, 'simulated_badge')}</span>
          </div>

          {/* Bottom-Left Text Block: max-width 55%, right 45% empty */}
          <div className="px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6 max-w-full sm:max-w-[70%] md:max-w-[55%]">
            {/* 1. Role Badge */}
            <div className="hero-anim-badge flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-[6px] bg-emerald-950/80 text-emerald-200 border border-emerald-700/60">
                {roleLabel}
              </span>
              {offlineMode && (
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-[6px] bg-red-950/80 text-red-200 border border-red-700/60 flex items-center gap-1">
                  <WifiOff className="w-3.5 h-3.5" /> {t(lang, 'offline_cached')}
                </span>
              )}
            </div>

            {/* 2. Title: clamp(30px, 3.6vw, 52px), weight 700, line-height 1.1 */}
            <h1
              className="hero-anim-title font-bold mt-1.5 sm:mt-2 tracking-tight text-white"
              style={{
                fontSize: 'clamp(30px, 3.6vw, 52px)',
                lineHeight: '1.1',
              }}
            >
              {heroTitle}
            </h1>

            {/* 3. Subtitle */}
            <p className="hero-anim-subtitle text-xs sm:text-sm text-emerald-100/85 mt-1 sm:mt-1.5 line-clamp-2">
              {subtitle ||
                `${t(lang, 'subtitle')} — Relative simulated exposure & resource-feasible CP-SAT scheduling.`}
            </p>

            {/* 4. Action Buttons inside hero on Coordinator Command Center */}
            {actions && (
              <div className="hero-anim-actions mt-3 sm:mt-4 flex items-center gap-2.5 flex-wrap">
                {actions}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Fixed 56px Sticky Bar When Hero Scrolled Out of View */}
      <header
        aria-label="Sticky Top Bar"
        className={`fixed top-0 left-0 right-0 h-[56px] z-50 bg-[rgba(4,16,10,0.95)] backdrop-blur border-b border-emerald-900/50 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 text-white transition-all duration-200 ease-out ${
          !heroInView
            ? 'translate-y-0 opacity-100'
            : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
          <button
            onClick={openSidebar}
            aria-expanded={sidebarOpen}
            aria-label="Open navigation"
            className="p-1.5 rounded-[6px] hover:bg-white/10 transition cursor-pointer"
          >
            <Menu className="w-5 h-5 text-white" />
          </button>
          <div className="font-bold tracking-tight text-sm sm:text-base text-white leading-none">
            MAHALISHIELD
          </div>
          {/* Disclaimer pill in sticky bar - always visible */}
          <span className="role-top-pill text-xs font-medium text-amber-200 px-2.5 py-1 rounded-[6px] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="hidden sm:inline">{t(lang, 'simulated_badge')}</span>
            <span className="sm:hidden text-[11px]">SIMULATED RESULT</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <button
            onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
            className="role-top-pill px-2.5 sm:px-3 py-1.5 rounded-[6px] text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-white/10 transition"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-300" />
            <span>{lang === 'en' ? 'ಕನ್ನಡ (KN)' : 'English (EN)'}</span>
          </button>

          <Link
            to="/notifications"
            className="role-top-pill relative p-2 rounded-[6px] hover:bg-white/10 transition flex items-center justify-center"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4 text-white" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Link>
        </div>
      </header>
    </>
  );
};
