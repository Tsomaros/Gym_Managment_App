import type { Exercise, MuscleGroup } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

export const SEARCH_DELAY_MS = 200;
/** What the API accepts for `q`; longer text (a paste) is cut, never sent to fail with a 400. */
export const MAX_QUERY_LENGTH = 80;

/**
 * The gym's exercises (unarchived), filtered by the API. Typing is debounced: the first request
 * goes out at once, later ones after a short pause, and an answer to an older query never
 * replaces a newer one. `stale` is true while the list on screen does not answer what is typed
 * or chosen yet (waiting for the pause, or for the response): callers must not act on it.
 */
export function useExercises(gymId: string, q: string, muscleGroup?: MuscleGroup) {
  const [settled, setSettled] = useState(q);
  const [items, setItems] = useState<Exercise[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(q), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const params = new URLSearchParams();
  const text = settled.trim().slice(0, MAX_QUERY_LENGTH).trim();
  if (text) params.set('q', text);
  if (muscleGroup) params.set('muscleGroup', muscleGroup);
  const query = params.size ? `?${params}` : '';
  const key = `${gymId}${query}`;

  useEffect(() => {
    let current = true;
    setFailed(false);
    apiFetch<Exercise[]>(`/gyms/${gymId}/exercises${query}`)
      .then((list) => {
        if (!current) return;
        setItems(list);
        setLoadedFor(key);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [gymId, query, key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { items, failed, reload, stale: settled !== q || loadedFor !== key };
}
