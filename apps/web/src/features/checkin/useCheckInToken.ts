import type { CheckInTokenResponse } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';

/** The server accepts a code for 45 s; asking every 30 s keeps a fresh one on screen. */
const REFRESH_MS = 30_000;

interface Held {
  token: string;
  expiresAt: number;
}

/**
 * The member's rotating check-in code: fetched on mount, every 30 s, and at once when the tab
 * comes back to the front or the network returns. It never returns a code past its expiry; a failed
 * refresh sets `error` but keeps a code that has not expired yet.
 */
export function useCheckInToken(gymId: string | undefined): {
  token: string | null;
  secondsLeft: number;
  error: boolean;
  retry: () => void;
} {
  const [held, setHeld] = useState<Held | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);

  const load = useCallback(() => {
    if (!gymId) return;
    const request = ++latest.current;
    apiFetch<CheckInTokenResponse>(`/gyms/${gymId}/me/check-in-token`)
      .then((r) => {
        if (request !== latest.current) return; // a newer request or an unmount took over
        setHeld({ token: r.token, expiresAt: Date.parse(r.expiresAt) });
        setError(false);
        setNow(Date.now());
      })
      .catch(() => {
        if (request !== latest.current) return;
        // Keep the code: it is valid for 45 s and refreshed every 30, so one missed refresh on
        // flaky mobile data must not blank a code that still works. `valid` drops it at expiry.
        setError(true);
      });
  }, [gymId]);

  useEffect(() => {
    // A code is for one gym: never keep showing the previous gym's while the new one loads.
    setHeld(null);
    setError(false);
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Back online (lift, locker room): fetch at once instead of waiting for a tap or the timer.
    window.addEventListener('online', load);
    return () => {
      latest.current++; // ignore anything still in flight
      clearInterval(refresh);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
    };
  }, [load]);

  const valid = held && now < held.expiresAt ? held : null;
  return {
    token: valid?.token ?? null,
    secondsLeft: valid ? Math.ceil((valid.expiresAt - now) / 1000) : 0,
    error,
    retry: load,
  };
}
