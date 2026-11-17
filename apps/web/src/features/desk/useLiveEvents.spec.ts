import type { LiveEvent } from '@gym/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../../test/fakeEventSource';
import { checkInResult, GYM, json } from '../../test/fixtures';
import { useLiveEvents } from './useLiveEvents';

describe('useLiveEvents', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let tickets: number;
  let ticketFails: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.reset();
    tickets = 0;
    ticketFails = false;
    fetchMock = vi.fn<typeof fetch>(async () => {
      if (ticketFails) return json(500, {});
      tickets += 1;
      return json(201, { ticket: `T${tickets}` });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
  const ticketCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u) === `/api/gyms/${GYM}/live/tickets`);

  it('trades a ticket for a stream and shows "connected" only once the stream is open', async () => {
    const { result } = renderHook(() => useLiveEvents(GYM, vi.fn()));
    await settle();
    expect(ticketCalls()).toHaveLength(1);
    expect(ticketCalls()[0]![1]?.method).toBe('POST');
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.last.url).toBe(`/api/gyms/${GYM}/live?ticket=T1`);
    expect(result.current.connected).toBe(false);

    act(() => FakeEventSource.last.emit('open'));
    expect(result.current.connected).toBe(true);
  });

  it('passes check_in and check_out events on, parsed', async () => {
    const onEvent = vi.fn<(e: LiveEvent) => void>();
    renderHook(() => useLiveEvents(GYM, onEvent));
    await settle();
    const event: LiveEvent = { type: 'check_in', result: checkInResult() };
    act(() => FakeEventSource.last.emit('check_in', event));
    act(() => FakeEventSource.last.emit('check_out', { type: 'check_out', checkInId: 'x' }));
    expect(onEvent).toHaveBeenNthCalledWith(1, event);
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: 'check_out', checkInId: 'x' });
  });

  it('ignores an event whose data is not valid JSON', async () => {
    const onEvent = vi.fn();
    renderHook(() => useLiveEvents(GYM, onEvent));
    await settle();
    const es = FakeEventSource.last as unknown as {
      listeners: Map<string, ((e: { data?: string }) => void)[]>;
    };
    expect(() => act(() => es.listeners.get('check_in')![0]!({ data: '{nope' }))).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('always calls the latest callback, without reconnecting', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useLiveEvents(GYM, cb), {
      initialProps: { cb: first },
    });
    await settle();
    rerender({ cb: second });
    act(() => FakeEventSource.last.emit('check_out', { type: 'check_out', checkInId: 'x' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('after an error asks for a new ticket and opens a new stream after 1 s, then reports connected again', async () => {
    const { result } = renderHook(() => useLiveEvents(GYM, vi.fn()));
    await settle();
    const first = FakeEventSource.last;
    act(() => first.emit('open'));
    expect(result.current.connected).toBe(true);

    act(() => first.emit('error'));
    expect(result.current.connected).toBe(false);
    expect(first.closed).toBe(true);

    await settle(999);
    expect(ticketCalls()).toHaveLength(1);
    await settle(1);
    expect(ticketCalls()).toHaveLength(2);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.last.url).toBe(`/api/gyms/${GYM}/live?ticket=T2`);
    expect(result.current.connected).toBe(false);

    act(() => FakeEventSource.last.emit('open'));
    expect(result.current.connected).toBe(true);
  });

  it('backs off 1 s, 2 s, 5 s, then 10 s while the server keeps failing, and starts over after a success', async () => {
    renderHook(() => useLiveEvents(GYM, vi.fn()));
    await settle();
    const waits: number[] = [];
    for (const expected of [1000, 2000, 5000, 10000, 10000]) {
      const before = FakeEventSource.instances.length;
      act(() => FakeEventSource.last.emit('error'));
      await settle(expected - 1);
      expect(FakeEventSource.instances).toHaveLength(before);
      await settle(1);
      expect(FakeEventSource.instances).toHaveLength(before + 1);
      waits.push(expected);
    }
    expect(waits).toEqual([1000, 2000, 5000, 10000, 10000]);

    act(() => FakeEventSource.last.emit('open'));
    act(() => FakeEventSource.last.emit('error'));
    await settle(999);
    const count = FakeEventSource.instances.length;
    await settle(1);
    expect(FakeEventSource.instances).toHaveLength(count + 1);
  });

  it('retries with backoff when the ticket request fails, and connects when it works again', async () => {
    ticketFails = true;
    const { result } = renderHook(() => useLiveEvents(GYM, vi.fn()));
    await settle();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);

    ticketFails = false;
    await settle(1000);
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => FakeEventSource.last.emit('open'));
    expect(result.current.connected).toBe(true);
  });

  it('closes the stream and stops reconnecting on unmount', async () => {
    const { unmount } = renderHook(() => useLiveEvents(GYM, vi.fn()));
    await settle();
    const es = FakeEventSource.last;
    act(() => es.emit('error'));
    unmount();
    await settle(30_000);
    expect(es.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(ticketCalls()).toHaveLength(1);
  });

  it('closes a stream that finished opening after the screen was left', async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(201, { ticket: 'late' }));
        }),
    );
    const { unmount } = renderHook(() => useLiveEvents(GYM, vi.fn()));
    unmount();
    await act(async () => release());
    await settle();
    expect(FakeEventSource.instances.every((es) => es.closed)).toBe(true);
  });
});
