import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  apiRequest,
  clearAuthSession,
  getStoredToken,
  getStoredUser,
  setAuthSession,
} from '../services/api';
import type { User } from '../types';
import type { Lang } from '../utils/i18n';

interface ToastMessage {
  id: number;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface AppContextValue {
  user: User | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  login: (token: string, u: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  toasts: ToastMessage[];
  pushToast: (title: string, message: string, type?: ToastMessage['type']) => void;
  dismissToast: (id: number) => void;
  unreadCount: number;
  refreshNotifications: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [lang, setLangState] = useState<Lang>(() => (getStoredUser()?.language as Lang) || 'en');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const pushToast = (title: string, message: string, type: ToastMessage['type'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5500);
  };

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const setLang = (l: Lang) => {
    setLangState(l);
    if (user) {
      const updated = { ...user, language: l };
      setUser(updated);
      const tok = getStoredToken();
      if (tok) setAuthSession(tok, updated);
      apiRequest('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ language: l }),
      }).catch(() => {});
    }
  };

  const login = (token: string, u: User) => {
    setAuthSession(token, u);
    setUser(u);
    setLangState((u.language as Lang) || 'en');
  };

  const logout = () => {
    clearAuthSession();
    setUser(null);
  };

  const refreshUser = async () => {
    const token = getStoredToken();
    if (!token) return;
    try {
      const u = await apiRequest<User>('/auth/me');
      setAuthSession(token, u);
      setUser(u);
    } catch {
      clearAuthSession();
      setUser(null);
    }
  };

  const refreshNotifications = async () => {
    if (!getStoredToken()) return;
    try {
      const list = await apiRequest<{ is_read: boolean }[]>('/notifications');
      setUnreadCount(list.filter((n) => !n.is_read).length);
    } catch {
      // ignore offline
    }
  };

  useEffect(() => {
    if (getStoredToken()) {
      refreshUser();
      refreshNotifications();
    }
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        lang,
        setLang,
        login,
        logout,
        refreshUser,
        toasts,
        pushToast,
        dismissToast,
        unreadCount,
        refreshNotifications,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
