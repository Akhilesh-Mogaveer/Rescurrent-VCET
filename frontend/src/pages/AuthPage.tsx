import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudRain, KeyRound, Lock, Mail, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';
import type { User } from '../types';

export const AuthPage: React.FC = () => {
  const { login, pushToast } = useApp();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('coordinator@mahalishield.org');
  const [password, setPassword] = useState('Mahali@2026');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'farmer' | 'coordinator' | 'admin'>('farmer');
  const [language, setLanguage] = useState<'en' | 'kn'>('en');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuickDemoLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Mahali@2026');
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: demoEmail, password: 'Mahali@2026' }),
      });
      login(res.access_token, res.user);
      pushToast('Signed In', `Welcome back, ${res.user.full_name}`, 'success');
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiRequest<{ access_token: string; user: User }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        login(res.access_token, res.user);
        pushToast('Signed In', `Welcome, ${res.user.full_name}`, 'success');
        navigate('/');
      } else if (mode === 'register') {
        const res = await apiRequest<{ access_token: string; user: User }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email,
            full_name: fullName,
            password,
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
              body: JSON.stringify({ email }),
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
              email,
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

  return (
    <div className="min-h-screen grid lg:grid-cols-12 bg-[#0C1F17] text-white">
      {/* Left Brand Intelligence Column */}
      <div className="lg:col-span-7 p-8 lg:p-16 flex flex-col justify-between bg-gradient-to-br from-[#0C1F17] via-[#112A20] to-[#0A1913] border-b lg:border-b-0 lg:border-r border-emerald-900/60">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <span className="font-bold tracking-tight text-xl text-white">MAHALISHIELD</span>
              <span className="ml-2 text-xs px-2.5 py-0.5 rounded-full bg-emerald-900/80 text-emerald-300 border border-emerald-700">
                CP-SAT + Ensemble Twin v1.0
              </span>
            </div>
          </div>

          <h1 className="mt-10 text-3xl lg:text-5xl font-bold tracking-tight leading-tight text-white">
            Win the gaps between the rains.
          </h1>
          <p className="mt-4 text-base lg:text-lg text-emerald-100/80 max-w-2xl leading-relaxed">
            Uncertainty-aware farm protection planning for arecanut growers and cooperative
            coordinators during monsoon breaks. Transforms ensemble rainfall scenarios, wetness &
            protection decay dynamics, crew shifts, and sprayer capacity into validated,
            explainable schedules.
          </p>

          <div className="mt-8 grid sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/60">
              <CloudRain className="w-5 h-5 text-emerald-400 mb-2" />
              <div className="text-sm font-semibold">Rain-Gap Ensemble Twin</div>
              <p className="text-xs text-emerald-200/75 mt-1">
                30-member rainfall fan charts, dry-window probabilities, and rain-return risk.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/60">
              <Users className="w-5 h-5 text-emerald-400 mb-2" />
              <div className="text-sm font-semibold">OR-Tools CP-SAT Scheduler</div>
              <p className="text-xs text-emerald-200/75 mt-1">
                Hard crew exclusivity, inter-plot travel buffers, equipment capacity, and precedence.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/60">
              <UserCheck className="w-5 h-5 text-emerald-400 mb-2" />
              <div className="text-sm font-semibold">Scientific Governance</div>
              <p className="text-xs text-emerald-200/75 mt-1">
                Transparent conceptual exposure indices — never unvalidated disease probabilities.
              </p>
            </div>
          </div>
        </div>

        {/* One-Click Demo Role Access */}
        <div className="mt-10 pt-6 border-t border-emerald-900/80">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-3">
            Instant Demo Role Sign-In (Password: Mahali@2026)
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('coordinator@mahalishield.org')}
              className="p-3 rounded-xl bg-emerald-800/40 hover:bg-emerald-700/50 border border-emerald-600/50 text-left transition cursor-pointer"
            >
              <div className="text-xs font-bold text-white">Cooperative Coordinator</div>
              <div className="text-[11px] text-emerald-300 truncate">
                coordinator@mahalishield.org
              </div>
              <div className="text-[10px] text-emerald-200/70 mt-1">
                Full Command Center, Optimizer, Replanning
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('farmer@mahalishield.org')}
              className="p-3 rounded-xl bg-emerald-900/40 hover:bg-emerald-800/50 border border-emerald-700/50 text-left transition cursor-pointer"
            >
              <div className="text-xs font-bold text-white">Arecanut Grower (Farmer)</div>
              <div className="text-[11px] text-emerald-300 truncate">farmer@mahalishield.org</div>
              <div className="text-[10px] text-emerald-200/70 mt-1">
                Plot Advisory, Kannada/English, Offline Plan
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('expert@mahalishield.org')}
              className="p-3 rounded-xl bg-emerald-900/40 hover:bg-emerald-800/50 border border-emerald-700/50 text-left transition cursor-pointer"
            >
              <div className="text-xs font-bold text-white">Agricultural Expert / Admin</div>
              <div className="text-[11px] text-emerald-300 truncate">expert@mahalishield.org</div>
              <div className="text-[10px] text-emerald-200/70 mt-1">
                Model Governance, Provenance & Audit
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Right Form Column */}
      <div className="lg:col-span-5 bg-[#F6F5F0] text-[#17211C] p-8 lg:p-14 flex flex-col justify-center">
        <div className="max-w-md w-full mx-auto bg-white rounded-2xl border border-stone-200/90 shadow-sm p-8">
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
                mode === 'register'
                  ? 'bg-[#0C1F17] text-white'
                  : 'text-stone-600 hover:text-stone-900'
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
                mode === 'forgot'
                  ? 'bg-[#0C1F17] text-white'
                  : 'text-stone-600 hover:text-stone-900'
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

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-stone-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Interface Language
                  </label>
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
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Reset Token
                  </label>
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
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    New Password
                  </label>
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
    </div>
  );
};
