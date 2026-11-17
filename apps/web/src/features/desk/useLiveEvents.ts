import type { LiveEvent } from '@gym/shared';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';

/** Waits before reconnecting: 1 s, 2 s, 5 s, then every 10 s. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000];

/**
 * The reception screen's live link (Server-Sent Events). It trades the signed-in session for a
 * single-use ticket, opens the stream, and after any failure asks for a new ticket and tries
 * again with a growing pause. `connected` is true only while a stream is open, so the screen can
 * say "reconnecting" instead of silently showing stale data.
 */
export function useLiveEvents(
  gymId: string | undefined,
  onEvent: (event: LiveEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!gymId) return;
    let stopped = false;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const retry = () => {
      if (stopped) return;
      setConnected(false);
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!;
      failures += 1;
      timer = setTimeout(connect, wait);
    };

    const connect = () => {
      apiFetch<{ ticket: string }>(`/gyms/${gymId}/live/tickets`, { method: 'POST' })
        .then(({ ticket }) => {
          if (stopped) return;
          const es = new EventSource(
            `/api/gyms/${gymId}/live?ticket=${encodeURIComponent(ticket)}`,
          );
          source = es;
          es.addEventListener('open', () => {
            failures = 0;
            setConnected(true);
          });
          es.addEventListener('error', () => {
            // Close it ourselves: the browser would reconnect with the used-up ticket.
            es.close();
            retry();
          });
          for (const type of ['check_in', 'check_out'] as const) {
            es.addEventListener(type, (e) => {
              try {
                onEventRef.current(JSON.parse((e as MessageEvent<string>).data) as LiveEvent);
              } catch {
                // a malformed event is dropped; the next one still arrives
              }
            });
          }
        })
        .catch(retry);
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      setConnected(false);
    };
  }, [gymId]);

  return { connected };
}
