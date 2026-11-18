import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueue,
  flush,
  pending,
  type QueuedOp,
  resetQueueForTests,
  setQueueOwner,
  size,
} from './workoutQueue';
import { resumableFromQueue } from './resumeFromQueue';

const BASE = '/gyms/g/me/sessions';
const S1 = '11111111-1111-4111-8111-111111111111';
const DAY = 'd1111111-1111-4111-8111-111111111111';

const sessionPut = (id: string, body: object): QueuedOp => ({
  method: 'PUT',
  path: `${BASE}/${id}`,
  body: { startedAt: '2027-05-12T08:00:00.000Z', ...body },
});
const setPut = (session: string, setId: string, index: number): QueuedOp => ({
  method: 'PUT',
  path: `${BASE}/${session}/sets/${setId}`,
  body: {
    exerciseId: 'e1',
    setIndex: index,
    reps: 8,
    weightKg: 50,
    done: true,
    loggedAt: '2027-05-12T08:05:00.000Z',
  },
});

describe('what stays on a shared phone', () => {
  beforeEach(() => {
    localStorage.clear();
    resetQueueForTests();
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
    vi.restoreAllMocks();
  });

  describe('a workout that was finished offline', () => {
    it('is not picked up again: reopening the same day starts a new session', () => {
      enqueue(sessionPut(S1, { planDayId: DAY }));
      enqueue(setPut(S1, 's-1', 0));
      enqueue(sessionPut(S1, { planDayId: DAY, finishedAt: '2027-05-12T09:00:00.000Z' }));
      expect(resumableFromQueue(BASE, DAY)).toBeNull();
    });

    it('is not picked up as a free workout either', () => {
      enqueue(sessionPut(S1, {}));
      enqueue(setPut(S1, 's-1', 0));
      enqueue(sessionPut(S1, { finishedAt: '2027-05-12T09:00:00.000Z' }));
      expect(resumableFromQueue(BASE, undefined)).toBeNull();
    });

    it('an unfinished one is resumed with its queued sets, a deleted set left out', () => {
      enqueue(sessionPut(S1, { planDayId: DAY }));
      enqueue(setPut(S1, 's-1', 0));
      enqueue(setPut(S1, 's-2', 1));
      enqueue({ method: 'DELETE', path: `${BASE}/${S1}/sets/s-2` });
      const found = resumableFromQueue(BASE, DAY);
      expect(found?.id).toBe(S1);
      expect(found?.sets.map((s) => s.id)).toEqual(['s-1']);
    });

    it('another unfinished workout is still resumed when an older one was finished', () => {
      const S0 = '00000000-0000-4000-8000-0000000000aa';
      enqueue(sessionPut(S0, { planDayId: DAY }));
      enqueue(sessionPut(S0, { planDayId: DAY, finishedAt: '2027-05-11T09:00:00.000Z' }));
      enqueue(sessionPut(S1, { planDayId: DAY }));
      expect(resumableFromQueue(BASE, DAY)?.id).toBe(S1);
    });
  });

  describe('the queue belongs to whoever is signed in', () => {
    it('sends nothing of another member’s workout, and keeps it for them', async () => {
      setQueueOwner('member-a');
      enqueue(sessionPut(S1, {}));
      enqueue(setPut(S1, 's-1', 0));
      expect(size()).toBe(2);

      setQueueOwner('member-b'); // someone else signs in on the same phone
      expect(size()).toBe(0);
      expect(pending()).toEqual([]);
      const sent: QueuedOp[] = [];
      await flush(async (op) => void sent.push(op));
      expect(sent).toEqual([]);
      expect(resumableFromQueue(BASE, undefined)).toBeNull();

      enqueue(sessionPut('22222222-2222-4222-8222-222222222222', {}));
      expect(size()).toBe(1);

      setQueueOwner('member-a'); // A comes back: their two operations are still there, in order
      expect(size()).toBe(2);
      await flush(async (op) => void sent.push(op));
      expect(sent.map((o) => o.path)).toEqual([`${BASE}/${S1}`, `${BASE}/${S1}/sets/s-1`]);
      // and B's is still waiting for B
      setQueueOwner('member-b');
      expect(size()).toBe(1);
    });

    it('an operation the other member left at the head does not block anyone', async () => {
      setQueueOwner('member-a');
      enqueue(sessionPut(S1, {}));
      setQueueOwner('member-b');
      enqueue(sessionPut('22222222-2222-4222-8222-222222222222', {}));
      const sent: string[] = [];
      await flush(async (op) => void sent.push(op.path));
      expect(sent).toEqual([`${BASE}/22222222-2222-4222-8222-222222222222`]);
    });
  });

  describe('two tabs of the same app', () => {
    it('take turns sending: the queue is flushed under one lock shared by every tab', async () => {
      const order: string[] = [];
      const request = vi.fn(async (name: string, cb: () => Promise<void>) => {
        order.push(`lock:${name}`);
        await cb();
        order.push('unlock');
      });
      Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
      enqueue(sessionPut(S1, {}));
      await flush(async (op) => void order.push(`send:${op.path.split('/').pop()}`));
      expect(request).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['lock:gym-workout-flush', `send:${S1}`, 'unlock']);
    });

    it('works where there is no Web Locks API', async () => {
      enqueue(sessionPut(S1, {}));
      const sent: string[] = [];
      await flush(async (op) => void sent.push(op.path));
      expect(sent).toHaveLength(1);
    });
  });
});
