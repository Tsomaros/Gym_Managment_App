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
  /** Whose workout it is: the phone may be shared, and `/me/...` means "whoever is signed in". */
  owner?: string | null;
}

let memory: Entry[] = [];
/** The signed-in person: the queue only shows and sends their operations. */
let owner: string | null = null;

export function setQueueOwner(userId: string | null): void {
  if (owner === userId) return;
  owner = userId;
  for (const l of listeners) l();
}
const isMine = (e: Entry): boolean => (e.owner ?? null) === owner;
let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

function readAll(): Entry[] {
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

const read = (): Entry[] => readAll().filter(isMine);

export const size = (): number => read().length;

/** The signed-in person's operations still waiting, oldest first. */
export const pending = (): QueuedOp[] => read().map(({ id: _id, owner: _owner, ...op }) => op);

/** Calls `listener` whenever the queue grows or shrinks. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueue(op: QueuedOp): void {
  write([...readAll(), { ...op, id: newId(), owner }]);
}

/** A 4xx other than "sign in again", "not allowed (yet)" or "slow down" is final: sending it again cannot help. */
const isRefusal = (err: unknown): boolean =>
  err instanceof ApiError &&
  err.status >= 400 &&
  err.status < 500 &&
  ![401, 403, 408, 429].includes(err.status);

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
  const run = async (): Promise<void> => {
    for (;;) {
      const [next] = read();
      if (!next) return;
      const { id } = next;
      // only what the server is sent: the entry's id and owner stay on this phone
      const op: QueuedOp = { method: next.method, path: next.path, body: next.body };
      if (next.body === undefined) delete op.body;
      try {
        await send(op);
      } catch (err) {
        if (!isRefusal(err)) return;
        onDropped?.(op, err);
      }
      // By id: another tab may have sent and removed operations meanwhile.
      write(readAll().filter((e) => e.id !== id));
    }
  };
  // One sender at a time across every open tab: two tabs sending the same head operation could
  // deliver an older copy of a set after a newer one. The lock, like the page's own guard,
  // is released by .finally on the promise itself (an empty queue finishes before assignment).
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  flushing ??= (locks ? locks.request('gym-workout-flush', run) : run()).finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Test helper: a fresh page over the same storage. */
export function resetQueueForTests(): void {
  memory = [];
  owner = null;
  flushing = null;
  listeners.clear();
}
