import type { AcceptInviteResponse, MeResponse } from '@gym/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, onSignedOut, refreshSession, setAccessToken } from '../api/client';
import { setLanguage } from '../i18n';

export interface AuthState {
  me: MeResponse | null;
  /** 'loading' until the stored session (refresh cookie) has been tried. */
  status: 'loading' | 'ready';
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Starts a session from an access token the API just issued (e.g. after accepting an invite). */
  startSession(accessToken: string): Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth() outside <AuthProvider>');
  return auth;
}

export type { AcceptInviteResponse };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  const loadMe = useCallback(async () => {
    const profile = await apiFetch<MeResponse>('/auth/me');
    setMe(profile);
  }, []);

  const startSession = useCallback(
    async (accessToken: string) => {
      setAccessToken(accessToken);
      await loadMe();
    },
    [loadMe],
  );

  useEffect(() => onSignedOut(() => setMe(null)), []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (await refreshSession()) await loadMe();
      } catch {
        setAccessToken(null);
      } finally {
        if (!cancelled) setStatus('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await apiFetch<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await startSession(accessToken);
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setMe(null);
    }
  }, []);

  // Follow the account's language on sign-in only if the visitor hasn't picked one on this device.
  useEffect(() => {
    if (!me) return;
    try {
      if (!localStorage.getItem('gym.lang')) setLanguage(me.locale);
    } catch {
      // storage blocked: keep the current language
    }
  }, [me]);

  return (
    <AuthContext.Provider value={{ me, status, login, logout, startSession }}>
      {children}
    </AuthContext.Provider>
  );
}
