import React, { useEffect, useState } from 'react';
import { Globe, Save, Shield, Sliders, User as UserIcon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiRequest } from '../services/api';

export const SettingsPage: React.FC = () => {
  const { user, lang, setLang, refreshUser, pushToast } = useApp();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [units, setUnits] = useState<string>((user?.preferences?.units as string) || 'metric');
  const [timezone, setTimezone] = useState<string>(
    (user?.preferences?.timezone as string) || 'Asia/Kolkata',
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(
    user?.preferences?.notifications_enabled !== false,
  );
  const [usersList, setUsersList] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin') {
      apiRequest<any[]>('/users')
        .then(setUsersList)
        .catch(() => {});
    }
  }, [user?.role]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({
          full_name: fullName,
          phone,
          language: lang,
          preferences: {
            units,
            timezone,
            notifications_enabled: notificationsEnabled,
          },
        }),
      });
      await refreshUser();
      pushToast('Settings Saved', 'Profile, language, and preferences updated.', 'success');
    } catch (err: any) {
      pushToast('Update Error', err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (targetUserId: number, newRole: string) => {
    try {
      await apiRequest(`/users/${targetUserId}/role?role=${newRole}`, { method: 'PUT' });
      const updated = await apiRequest<any[]>('/users');
      setUsersList(updated);
      pushToast('Role Updated', `User #${targetUserId} role changed to ${newRole}`, 'success');
    } catch (err: any) {
      pushToast('Role Update Failed', err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
        <h1 className="text-2xl font-bold text-[#17211C]">
          Platform Settings, Language & Access Control
        </h1>
        <p className="text-xs text-stone-600 mt-1">
          Configure grower/coordinator profile, English & ಕನ್ನಡ (Kannada) bilingual labels,
          units/timezone, and administrator role assignments.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-7 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4 text-xs"
        >
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-emerald-700" />
            User Profile & Regional Preferences
          </h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-300"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold text-stone-700 mb-1 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-emerald-700" /> Interface Language
              </label>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as 'en' | 'kn')}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white font-semibold"
              >
                <option value="en">English (EN)</option>
                <option value="kn">ಕನ್ನಡ (Kannada - KN)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Measurement Units</label>
              <select
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white"
              >
                <option value="metric">Metric (mm/h, acres, km)</option>
                <option value="imperial">Imperial (in/h, acres, mi)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Cluster Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST +05:30)</option>
                <option value="UTC">UTC (+00:00)</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 font-semibold text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
              />
              Receive real-time schedule & early-rainfall disruption notifications
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-[#0C1F17] hover:bg-emerald-950 text-white font-bold flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Profile & Preferences'}
          </button>
        </form>

        {/* Security & Role Info */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-4 text-xs">
          <h2 className="text-sm font-bold text-[#17211C] flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-700" />
            Account Security & Role Access Level
          </h2>
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
            <div>
              <strong>Signed-in Email:</strong> {user?.email}
            </div>
            <div>
              <strong>Active RBAC Role:</strong>{' '}
              <span className="uppercase font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900">
                {user?.role}
              </span>
            </div>
            <p className="text-stone-600 leading-relaxed">
              • <strong>Farmer:</strong> View cluster rainfall, relative exposure, approved schedules
              (online & offline), and manage own plots.
              <br />• <strong>Coordinator:</strong> Full operational CRUD, CP-SAT optimization,
              Policy Arena, and dynamic replanning.
              <br />• <strong>Admin / Expert:</strong> Model parameter governance, provenance review,
              and user role management.
            </p>
          </div>

          {user?.role === 'admin' && usersList.length > 0 && (
            <div className="pt-3 border-t border-stone-200 space-y-2">
              <h3 className="font-bold text-[#17211C] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-emerald-700" />
                Administrator User Role Control
              </h3>
              {usersList.map((u) => (
                <div
                  key={u.id}
                  className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold">{u.full_name}</div>
                    <div className="text-[11px] text-stone-500">{u.email}</div>
                  </div>
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    className="px-2 py-1 rounded border border-stone-300 bg-white font-semibold"
                  >
                    <option value="farmer">farmer</option>
                    <option value="coordinator">coordinator</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
