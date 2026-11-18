import { ApiError } from '../../api/client';

/**
 * Writes of a workout in progress, kept in order until the server has them. The phone may be
 * offline between sets: every change is queued here (localStorage, in memory when storage is
 * blocked) and replayed when the network is back. The server's PUTs are idempotent (client ids),
 * so a replay, a retry after a timeout or a second tab sending the same operation changes nothing.
 */
export const QUEUE_KEY = 'gym.workoutQueue';

export interface QueuedOp {
  method: 'PUT' | 'DELETE' | 'POST';
  /** Path as given to apiFetch, e.g. `/gyms/<id>/me/sessions/<id>`. */
  path: string;
  body?: unknown;
}

interface Entry extends QueuedOp {
  id: string;
}

let memory: Entry[] = [];
let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch (err) {
    // A corrupt value reads as empty; blocked storage falls back to the in-memory copy.
    if (err instanceof SyntaxError) return [];
    return memory;
  }
}

function write(entries: Entry[]): void {
  memory = entries;
  try {
    if (entries.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Blocked or full storage: the in-memory copy above still serves this page.
  }
  for (const l of listeners) l();
}

export const size = (): number => read().length;

/** Calls `listener` whenever the queue grows or shrinks. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueue(op: QueuedOp): void {
  write([...read(), { ...op, id: newId() }]);
}

/** A 4xx other than "sign in again" or "slow down" is final: sending it again cannot help. */
const isRefusal = (err: unknown): boolean =>
  err instanceof ApiError &&
  err.status >= 400 &&
  err.status < 500 &&
  ![401, 408, 429].includes(err.status);

/**
 * Sends the queued operations in order. A network error or a 5xx stops the run and keeps the
 * rest; a refusal drops that one operation (reported through `onDropped`) and goes on. One run at
 * a time per page: a second call waits for the one under way.
 */
export function flush(
  send: (op: QueuedOp) => Promise<void>,
  onDropped?: (op: QueuedOp, err: unknown) => void,
): Promise<void> {
  // The guard is released by .finally on the promise itself: an empty queue finishes the async
  // body before this line has assigned it, and a `finally` inside the body would run too early.
  flushing ??= (async () => {
    for (;;) {
      const [next] = read();
      if (!next) return;
      const { id, ...op } = next;
      try {
        await send(op);
      } catch (err) {
        if (!isRefusal(err)) return;
        onDropped?.(op, err);
      }
      // By id: another tab may have sent and removed operations meanwhile.
      write(read().filter((e) => e.id !== id));
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Test helper: a fresh page over the same storage. */
export function resetQueueForTests(): void {
  memory = [];
  flushing = null;
  listeners.clear();
}
