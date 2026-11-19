import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import type { User } from '../types';

interface RoleCardConfig {
  id: string;
  num: string;
  title: string;
  roleKey: 'coordinator' | 'farmer' | 'admin';
  desc: string;
  summary: string;
  accent: string;
  image: string;
  fallbackImage: string;
  defaultEmail: string;
  defaultPassword: string;
}

const ROLES: RoleCardConfig[] = [
  {
    id: 'coordinator',
    num: '01',
    title: 'Cooperative Coordinator',
    roleKey: 'coordinator',
    desc: 'Plan crews, sprayers, and schedules.',
    summary: 'Command center, optimizer, replanning',
    accent: '#10b981',
    image: '/roles/coordinator.webp',
    fallbackImage: '/page_img/coordinator.png',
    defaultEmail: 'coordinator@mahalishield.org',
    defaultPassword: 'Mahali@2026',
  },
  {
    id: 'grower',
    num: '02',
    title: 'Arecanut Grower',
    roleKey: 'farmer',
    desc: 'Plot advice in Kannada and English.',
    summary: 'Plot advisory, offline plan',
    accent: '#f59e0b',
    image: '/roles/grower.webp',
    fallbackImage: '/page_img/farmer.png',
    defaultEmail: 'farmer@mahalishield.org',
    defaultPassword: 'Mahali@2026',
  },
  {
    id: 'expert',
    num: '03',
    title: 'Agricultural Expert',
    roleKey: 'admin',
    desc: 'Model governance, provenance, and audit.',
    summary: 'Governance, provenance, audit',
    accent: '#3b82f6',
    image: '/roles/expert.webp',
    fallbackImage: '/page_img/admin.png',
    defaultEmail: 'expert@mahalishield.org',
    defaultPassword: 'Mahali@2026',
  },
];

export const AuthPage: React.FC = () => {
  const { login, pushToast } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const showTabs = searchParams.get('tabs') === 'true';

  // 3D Flip Card state
  const [flippedCard, setFlippedCard] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{
    [key: string]: { email: string; pass: string };
  }>({
    coordinator: { email: 'coordinator@mahalishield.org', pass: 'Mahali@2026' },
    grower: { email: 'farmer@mahalishield.org', pass: 'Mahali@2026' },
    expert: { email: 'expert@mahalishield.org', pass: 'Mahali@2026' },
  });
  const [cardImgErrors, setCardImgErrors] = useState<{ [key: string]: boolean }>({});
  const [cardImgFailed, setCardImgFailed] = useState<{ [key: string]: boolean }>({});

  // Legacy tabbed auth state (for Register & Reset Password flows)
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [legacyEmail, setLegacyEmail] = useState('coordinator@mahalishield.org');
  const [legacyPassword, setLegacyPassword] = useState('Mahali@2026');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'farmer' | 'coordinator' | 'admin'>('farmer');
  const [language, setLanguage] = useState<'en' | 'kn'>('en');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync role query param to legacy state if provided
  useEffect(() => {
    const roleParam = searchParams.get('role');
    if (roleParam === 'coordinator' || roleParam === 'farmer' || roleParam === 'admin') {
      setRole(roleParam);
      if (roleParam === 'coordinator') setLegacyEmail('coordinator@mahalishield.org');
      else if (roleParam === 'farmer') setLegacyEmail('farmer@mahalishield.org');
      else if (roleParam === 'admin') setLegacyEmail('expert@mahalishield.org');
    }
  }, [searchParams]);

  // Flip back on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFlippedCard(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-focus email field on card flip completion
  useEffect(() => {
    if (flippedCard) {
      const timer = setTimeout(() => {
        const input = document.getElementById(`email-input-${flippedCard}`);
        input?.focus();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [flippedCard]);

  // Handle Sign In from Back Face of Role Card
  const handleCardLogin = async (e: React.FormEvent, card: RoleCardConfig) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const cred = credentials[card.id] || { email: card.defaultEmail, pass: card.defaultPassword };
    try {
      const res = await apiRequest<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: cred.email, password: cred.pass }),
      });
      login(res.access_token, res.user);
      pushToast('Signed In', `Welcome, ${res.user.full_name}`, 'success');
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle Legacy Tabs Submit
  const handleLegacySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiRequest<{ access_token: string; user: User }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: legacyEmail, password: legacyPassword }),
        });
        login(res.access_token, res.user);
        pushToast('Signed In', `Welcome, ${res.user.full_name}`, 'success');
        navigate('/');
      } else if (mode === 'register') {
        const res = await apiRequest<{ access_token: string; user: User }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: legacyEmail,
            full_name: fullName,
            password: legacyPassword,
            role,
            language,
          }),
        });
        login(res.access_token, res.user);
        pushToast('Account Created', `Registered as ${res.user.role}`, 'success');
        navigate('/');
      } else if (mode === 'forgot') {
        if (!generatedToken) {
          const res = await apiRequest<{ message: string; demo_reset_token?: string }>(
            '/auth/forgot-password',
            {
              method: 'POST',
              body: JSON.stringify({ email: legacyEmail }),
            },
          );
          if (res.demo_reset_token) {
            setGeneratedToken(res.demo_reset_token);
            setResetToken(res.demo_reset_token);
            pushToast('Reset Token Generated', `Token: ${res.demo_reset_token}`, 'info');
          } else {
            pushToast('Reset Requested', res.message, 'info');
          }
        } else {
          await apiRequest('/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({
              email: legacyEmail,
              reset_token: resetToken,
              new_password: newPassword,
            }),
          });
          pushToast('Password Updated', 'Please sign in with your new password', 'success');
          setGeneratedToken(null);
          setMode('login');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  // If "Register or reset password" was clicked, show tabbed auth interface
  if (showTabs) {
    return (
      <div className="auth-page-bg flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="auth-rain-overlay" />
        <div className="relative z-10 max-w-md w-full bg-white rounded-2xl border border-stone-200/90 shadow-xl p-6 sm:p-8 text-[#17211C]">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setSearchParams({});
            }}
            className="mb-4 text-xs font-semibold text-emerald-800 hover:text-emerald-950 flex items-center gap-1.5 cursor-pointer transition"
          >
            ← Back to role selection
          </button>

          <div className="flex gap-2 mb-6 bg-stone-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                mode === 'login' ? 'bg-[#0C1F17] text-white' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                mode === 'register' ? 'bg-[#0C1F17] text-white' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                mode === 'forgot' ? 'bg-[#0C1F17] text-white' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Reset Password
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleLegacySubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g., Ramesh Gowda"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-stone-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={legacyEmail}
                  onChange={(e) => setLegacyEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-stone-400 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    value={legacyPassword}
                    onChange={(e) => setLegacyPassword(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:border-emerald-700"
                  />
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white"
                  >
                    <option value="farmer">Farmer / Grower</option>
                    <option value="coordinator">Cooperative Coordinator</option>
                    <option value="admin">Agricultural Expert / Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Language</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as any)}
                    className="w-full px-3 py-2.5 rounded-lg border border-stone-300 text-sm bg-white"
                  >
                    <option value="en">English</option>
                    <option value="kn">ಕನ್ನಡ (Kannada)</option>
                  </select>
                </div>
              </div>
            )}

            {mode === 'forgot' && generatedToken && (
              <>
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                  Demo Reset Code: <strong className="font-mono">{generatedToken}</strong>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Reset Token</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-stone-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      required
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-stone-300 text-sm font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">New Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-stone-300 text-sm"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#0C1F17] hover:bg-emerald-900 text-white font-semibold text-sm transition cursor-pointer disabled:opacity-50"
            >
              {loading
                ? 'Processing...'
                : mode === 'login'
                ? 'Sign In to MahaliShield'
                : mode === 'register'
                ? 'Create Account'
                : generatedToken
                ? 'Confirm New Password'
                : 'Generate Reset Code'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Primary 3D Flip Role Selection View
  return (
    <div className="auth-page-bg">
      {/* Optional ambient rain overlay */}
      <div className="auth-rain-overlay" />

      {/* Main Single Column Container (centered, max-width 1100px, vertical padding 48px) */}
      <div className="relative z-10 max-w-[1100px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col justify-between min-h-screen">
        {/* Top Header Row */}
        <div>
          <div className="auth-entrance-1 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="font-bold tracking-tight text-xl text-white leading-none">
              MAHALISHIELD
            </div>
          </div>

          {/* Headline & Subline */}
          <div className="mt-8 mb-6">
            <h1 className="auth-entrance-2 text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
              Win the gaps between the rains.
            </h1>
            <p className="auth-entrance-3 mt-2 text-sm sm:text-base text-white/70 max-w-2xl line-clamp-1">
              Rain-aware spray scheduling for arecanut growers and cooperatives.
            </p>
          </div>

          {/* Small label above cards */}
          <div className="auth-entrance-4 text-xs uppercase tracking-wider text-emerald-300/90 font-mono font-semibold mb-3">
            Choose your role
          </div>

          {/* Role Cards (CSS Grid, 3 columns, 24px gap, 420px tall) */}
          <div className="auth-cards-grid">
            {ROLES.map((card) => {
              const isFlipped = flippedCard === card.id;
              const cardCred = credentials[card.id] || {
                email: card.defaultEmail,
                pass: card.defaultPassword,
              };

              return (
                <div key={card.id} className="auth-card-wrapper">
                  <div className={`auth-card-inner ${isFlipped ? 'is-flipped' : ''}`}>
                    {/* FRONT FACE */}
                    <div
                      className="auth-card-face auth-card-front"
                      style={{
                        border: `1px solid ${card.accent}59`, // 35% opacity
                      }}
                      tabIndex={isFlipped ? -1 : 0}
                      role="button"
                      aria-label={`Explore ${card.title}`}
                      aria-hidden={isFlipped}
                      inert={isFlipped ? true : undefined}
                      onClick={() => {
                        setError(null);
                        setFlippedCard(card.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setError(null);
                          setFlippedCard(card.id);
                        }
                      }}
                    >
                      {/* Top content area */}
                      <div className="p-5 pb-2">
                        <div className="font-mono text-xs font-bold" style={{ color: card.accent }}>
                          {card.num}
                        </div>
                        <h2 className="text-xl font-semibold text-white mt-1 leading-snug">
                          {card.title}
                        </h2>
                        <p className="auth-card-desc">
                          {card.desc}
                        </p>
                        <div
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold cursor-pointer"
                          style={{
                            border: `1px solid ${card.accent}`,
                            color: card.accent,
                          }}
                        >
                          Explore <span className="auth-explore-arrow">→</span>
                        </div>
                      </div>

                      {/* Bottom ~60%: Role image with gradient fade & watermark crop */}
                      <div
                        className="auth-card-img-container"
                        style={{
                          background: cardImgFailed[card.id]
                            ? `linear-gradient(180deg, rgba(8,20,14,0.72) 0%, ${card.accent}30 100%)`
                            : undefined,
                        }}
                      >
                        <div className="absolute inset-0 z-10 pointer-events-none bg-gradient-to-b from-[rgba(8,20,14,0.95)] via-[rgba(8,20,14,0.3)] to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 h-8 z-10 pointer-events-none bg-gradient-to-t from-[rgba(8,20,14,0.98)] to-transparent" />
                        {!cardImgFailed[card.id] && (
                          <img
                            src={cardImgErrors[card.id] ? card.fallbackImage : card.image}
                            alt=""
                            aria-hidden="true"
                            className="auth-card-img"
                            onError={() => {
                              if (!cardImgErrors[card.id]) {
                                setCardImgErrors((prev) => ({ ...prev, [card.id]: true }));
                              } else {
                                setCardImgFailed((prev) => ({ ...prev, [card.id]: true }));
                              }
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {/* BACK FACE */}
                    <div
                      className="auth-card-face auth-card-back"
                      style={{
                        border: `1px solid ${card.accent}59`,
                      }}
                      aria-hidden={!isFlipped}
                      inert={!isFlipped ? true : undefined}
                    >
                      {/* Top header & Back link */}
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-lg font-semibold text-white leading-tight">
                            {card.title}
                          </h3>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFlippedCard(null);
                            }}
                            className="text-xs text-stone-400 hover:text-white flex items-center gap-1 cursor-pointer transition"
                            aria-label="Back to card front"
                          >
                            ← Back
                          </button>
                        </div>
                        <p className="text-xs text-stone-300 mt-1 line-clamp-1">
                          {card.summary}
                        </p>
                      </div>

                      {/* Inline error if any */}
                      {isFlipped && error && (
                        <div className="my-2 p-2.5 rounded-lg bg-red-950/80 border border-red-700/80 text-red-200 text-xs font-medium">
                          {error}
                        </div>
                      )}

                      {/* Sign in form */}
                      <form
                        onSubmit={(e) => handleCardLogin(e, card)}
                        className="space-y-3.5 my-auto"
                      >
                        <div className="auth-back-stagger-1">
                          <label className="block text-xs font-semibold text-stone-300 mb-1">
                            Email Address
                          </label>
                          <div className="relative">
                            <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                            <input
                              id={`email-input-${card.id}`}
                              type="email"
                              required
                              value={cardCred.email}
                              onChange={(e) =>
                                setCredentials((prev) => ({
                                  ...prev,
                                  [card.id]: { ...cardCred, email: e.target.value },
                                }))
                              }
                              className="w-full pl-9 pr-3 py-2 rounded-lg bg-black/40 border border-white/20 text-white text-xs placeholder-stone-500 focus:outline-none focus:border-white/50"
                            />
                          </div>
                        </div>

                        <div className="auth-back-stagger-2">
                          <label className="block text-xs font-semibold text-stone-300 mb-1">
                            Password
                          </label>
                          <div className="relative">
                            <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                            <input
                              type="password"
                              required
                              value={cardCred.pass}
                              onChange={(e) =>
                                setCredentials((prev) => ({
                                  ...prev,
                                  [card.id]: { ...cardCred, pass: e.target.value },
                                }))
                              }
                              className="w-full pl-9 pr-3 py-2 rounded-lg bg-black/40 border border-white/20 text-white text-xs placeholder-stone-500 focus:outline-none focus:border-white/50"
                            />
                          </div>
                        </div>

                        <div className="auth-back-stagger-3 pt-1">
                          <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 rounded-xl font-bold text-xs shadow-sm transition cursor-pointer disabled:opacity-50"
                            style={{
                              backgroundColor: card.accent,
                              color: '#0C1F17',
                            }}
                          >
                            {loading ? 'Signing In...' : 'Sign in'}
                          </button>
                        </div>
                      </form>

                      {/* Footer link to legacy tabs */}
                      <div className="auth-back-stagger-4 text-center pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setSearchParams({ tabs: 'true', role: card.roleKey });
                          }}
                          className="text-xs text-stone-400 hover:text-white underline cursor-pointer transition"
                        >
                          Register or reset password
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer line */}
        {/* <footer className="mt-8 text-center text-xs text-stone-400">
          Synthetic demo data · Simulated exposure, not disease probability
        </footer> */}
      </div>
    </div>
  );
};
