import type { Occupancy } from '@gym/shared';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

export const OCCUPANCY_POLL_MS = 60_000;

/**
 * How busy the gym is, refreshed every 60 seconds while the page is visible (a hidden tab does
 * not poll, and refreshes the moment it is shown again). A failed refresh keeps the last answer;
 * `null` means nothing has been learnt yet.
 */
export function useOccupancy(gymId: string): { occupancy: Occupancy | null } {
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);

  useEffect(() => {
    let current = true;
    setOccupancy(null);
    const load = () => {
      apiFetch<Occupancy>(`/gyms/${gymId}/occupancy`)
        .then((o) => current && setOccupancy(o))
        .catch(() => undefined); // the badge is a nicety: keep what it shows
    };
    const visible = () => document.visibilityState === 'visible';
    if (visible()) load();
    const timer = setInterval(() => {
      if (visible()) load();
    }, OCCUPANCY_POLL_MS);
    const onVisible = () => {
      if (visible()) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [gymId]);

  return { occupancy };
}
