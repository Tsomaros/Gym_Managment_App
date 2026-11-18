import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import {
  QUEUE_KEY,
  enqueue,
  flush,
  resetQueueForTests,
  size,
  subscribe,
  type QueuedOp,
} from './workoutQueue';

const put = (n: number): QueuedOp => ({
  method: 'PUT',
  path: `/gyms/g/me/sessions/s/sets/${n}`,
  body: { n },
});

describe('workoutQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    resetQueueForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it('flushes three queued PUTs in the order they were enqueued', async () => {
    enqueue(put(1));
    enqueue(put(2));
    enqueue(put(3));
    const sent: number[] = [];
    await flush(async (op) => void sent.push((op.body as { n: number }).n));
    expect(sent).toEqual([1, 2, 3]);
    expect(size()).toBe(0);
  });

  it('stops at the first network failure and keeps that operation and the rest', async () => {
    enqueue(put(1));
    enqueue(put(2));
    enqueue(put(3));
    const sent: number[] = [];
    await flush(async (op) => {
      const n = (op.body as { n: number }).n;
      if (n === 2) throw new TypeError('Failed to fetch');
      sent.push(n);
    });
    expect(sent).toEqual([1]);
    expect(size()).toBe(2);
    // back online: the rest goes, still in order
    await flush(async (op) => void sent.push((op.body as { n: number }).n));
    expect(sent).toEqual([1, 2, 3]);
    expect(size()).toBe(0);
  });

  it('keeps an operation the server failed on (5xx) and stops', async () => {
    enqueue(put(1));
    enqueue(put(2));
    await flush(async () => {
      throw new ApiError(503, undefined);
    });
    expect(size()).toBe(2);
  });

  it('drops an operation the server refuses (400), reports it and carries on', async () => {
    enqueue(put(1));
    enqueue(put(2));
    enqueue(put(3));
    const sent: number[] = [];
    const dropped: number[] = [];
    await flush(
      async (op) => {
        const n = (op.body as { n: number }).n;
        if (n === 2) throw new ApiError(400, { message: 'bad' });
        sent.push(n);
      },
      (op) => dropped.push((op.body as { n: number }).n),
    );
    expect(sent).toEqual([1, 3]);
    expect(dropped).toEqual([2]);
    expect(size()).toBe(0);
  });

  it('keeps everything while the session is signed out (401) or the server is throttling (429)', async () => {
    enqueue(put(1));
    await flush(async () => {
      throw new ApiError(401, undefined);
    });
    expect(size()).toBe(1);
    await flush(async () => {
      throw new ApiError(429, undefined);
    });
    expect(size()).toBe(1);
  });

  it('survives a reload: the queue is read back from localStorage', async () => {
    enqueue(put(1));
    enqueue(put(2));
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(2);
    resetQueueForTests(); // a fresh page, same storage
    expect(size()).toBe(2);
  });

  it('a flush of an empty queue does not block the next flush', async () => {
    await flush(async () => undefined); // nothing to send
    enqueue(put(1));
    const sent: number[] = [];
    await flush(async (op) => void sent.push((op.body as { n: number }).n));
    expect(sent).toEqual([1]);
    expect(size()).toBe(0);
  });

  it('two overlapping flushes send each operation only once from one tab', async () => {
    enqueue(put(1));
    enqueue(put(2));
    const sent: number[] = [];
    const send = async (op: QueuedOp) => {
      await new Promise((r) => setTimeout(r, 1));
      sent.push((op.body as { n: number }).n);
    };
    await Promise.all([flush(send), flush(send)]);
    expect(sent).toEqual([1, 2]);
  });

  it('keeps working in memory when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    enqueue(put(1));
    expect(size()).toBe(1);
    const sent: number[] = [];
    await flush(async (op) => void sent.push((op.body as { n: number }).n));
    expect(sent).toEqual([1]);
    expect(size()).toBe(0);
  });

  it('tells subscribers when the size changes', async () => {
    const seen: number[] = [];
    const off = subscribe(() => seen.push(size()));
    enqueue(put(1));
    await flush(async () => undefined);
    off();
    enqueue(put(2));
    expect(seen).toEqual([1, 0]);
  });

  it('ignores a corrupt stored queue instead of crashing', () => {
    localStorage.setItem(QUEUE_KEY, '{not json');
    resetQueueForTests();
    expect(size()).toBe(0);
    enqueue(put(1));
    expect(size()).toBe(1);
  });
});
