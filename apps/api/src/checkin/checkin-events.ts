import { Injectable } from '@nestjs/common';
import type { LiveEvent } from '@gym/shared';

/**
 * Live events per gym for the reception and trainer streams. Publishers call it after their
 * transaction commits.
 * shortcut: in-process events, use Postgres LISTEN/NOTIFY or Redis when running more than one API instance
 */
@Injectable()
export class CheckInEvents {
  private readonly listeners = new Map<string, Set<(e: LiveEvent) => void>>();

  publish(gymId: string, e: LiveEvent): void {
    for (const fn of this.listeners.get(gymId) ?? []) {
      try {
        fn(e);
      } catch {
        // one broken stream must not stop the others or fail the check-in that was just saved
      }
    }
  }

  /** Returns the function that unsubscribes. */
  subscribe(gymId: string, fn: (e: LiveEvent) => void): () => void {
    const set = this.listeners.get(gymId) ?? new Set();
    set.add(fn);
    this.listeners.set(gymId, set);
    return () => {
      set.delete(fn);
      if (!set.size && this.listeners.get(gymId) === set) this.listeners.delete(gymId);
    };
  }

  /** Open subscriptions of one gym (for tests and diagnostics). */
  listenerCount(gymId: string): number {
    return this.listeners.get(gymId)?.size ?? 0;
  }
}
