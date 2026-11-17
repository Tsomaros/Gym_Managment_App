import { useEffect } from 'react';

/**
 * Keeps the screen on while the member shows their code. The browser drops the lock whenever the
 * tab is hidden, so it is asked for again when the tab returns. Where the Wake Lock API is missing
 * (older iOS) this does nothing.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let closed = false;
    let pending = false;

    const acquire = async () => {
      // One request at a time: a second one would overwrite the first sentinel and leak it.
      if (pending || sentinel) return;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (closed) {
          await lock.release();
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch {
        // refused (low battery, not allowed): the code still works, the screen may just dim
      } finally {
        pending = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    };
  }, []);
}
