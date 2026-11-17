import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GYM, json } from '../../test/fixtures';
import { useCheckInToken } from './useCheckInToken';

describe('useCheckInToken', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let issued: number;
  let failing: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    issued = 0;
    failing = false;
    fetchMock = vi.fn<typeof fetch>(async () => {
      if (failing) throw new TypeError('offline');
      issued += 1;
      return json(200, {
        token: `GYM1.token${issued}.sig`,
        expiresAt: new Date(Date.now() + 45_000).toISOString(),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  const tokenCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/me/check-in-token')).length;

  it('fetches once on mount and exposes the token with 45 seconds left', async () => {
    const { result } = renderHook(() => useCheckInToken(GYM));
    await advance(0);
    expect(tokenCalls()).toBe(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/gyms/${GYM}/me/check-in-token`);
    expect(result.current).toMatchObject({
      token: 'GYM1.token1.sig',
      secondsLeft: 45,
      error: false,
    });
  });

  it('counts the seconds down and asks again 30 s after the first request', async () => {
    const { result } = renderHook(() => useCheckInToken(GYM));
    await advance(0);
    await advance(10_000);
    expect(result.current.secondsLeft).toBe(35);
    expect(tokenCalls()).toBe(1);
    await advance(19_999); // 29.999 s: a 29 s or shorter interval would already have asked
    expect(tokenCalls()).toBe(1);
    await advance(1);
    expect(tokenCalls()).toBe(2);
    expect(result.current.token).toBe('GYM1.token2.sig');
    expect(result.current.secondsLeft).toBe(45);
    await advance(29_999);
    expect(tokenCalls()).toBe(2);
    await advance(1);
    expect(tokenCalls()).toBe(3);
  });

  it('keeps the newest answer when an older request finishes late', async () => {
    const { result } = renderHook(() => useCheckInToken(GYM));
    await advance(0);
    // the next request is slow; the one after it is quick
    let finishSlow!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => (finishSlow = res)));
    await advance(30_000); // slow request starts
    await advance(30_000); // quick request answers: token2
    expect(result.current.token).toBe('GYM1.token2.sig');
    await act(async () => {
      finishSlow(
        json(200, {
          token: 'GYM1.stale.sig',
          expiresAt: new Date(Date.now() + 45_000).toISOString(),
        }),
      );
    });
    expect(result.current.token).toBe('GYM1.token2.sig');
  });

  it('asks again at once when the tab becomes visible, and not when it is hidden', async () => {
    renderHook(() => useCheckInToken(GYM));
    await advance(0);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(tokenCalls()).toBe(1);

    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(tokenCalls()).toBe(2);
    visibility.mockRestore();
  });

  it('shows no token and reports an error when the request fails, and recovers on the next try', async () => {
    failing = true;
    const { result } = renderHook(() => useCheckInToken(GYM));
    await advance(0);
    expect(result.current).toMatchObject({ token: null, error: true });

    failing = false;
    await advance(30_000);
    expect(result.current).toMatchObject({ token: 'GYM1.token1.sig', error: false });
  });

  it('keeps a still-valid token when one refresh fails, flags the error, and drops it at expiry', async () => {
    const { result } = renderHook(() => useCheckInToken(GYM));
    await advance(0); // token1 valid until 45 s
    failing = true;
    await advance(30_000); // refresh fails with 15 s of life left
    expect(result.current).toMatchObject({
      token: 'GYM1.token1.sig',
      error: true,
      secondsLeft: 15,
    });
    await advance(14_000);
    expect(result.current.token).toBe('GYM1.token1.sig');
    await advance(1_000); // 45 s: expired, and nothing newer arrived
    expect(result.current).toMatchObject({ token: null, error: true, secondsLeft: 0 });
  });

  it('asks again at once when the network comes back', async () => {
    renderHook(() => useCheckInToken(GYM));
    await advance(0);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(tokenCalls()).toBe(2);
  });

  it("never shows the previous gym's token while another gym loads", async () => {
    const { result, rerender } = renderHook(({ id }) => useCheckInToken(id), {
      initialProps: { id: GYM },
    });
    await advance(0);
    expect(result.current.token).toBe('GYM1.token1.sig');
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    rerender({ id: '22222222-2222-4222-8222-222222222222' });
    expect(result.current.token).toBeNull();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      '/api/gyms/22222222-2222-4222-8222-222222222222/me/check-in-token',
    );
  });

  it('never shows a token past its expiry, even if no refresh has answered yet', async () => {
    const { result } = renderHook(() => useCheckInToken(GYM));
    await advance(0);
    // the next request hangs: the old token must still disappear at its expiry
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    await advance(30_000);
    expect(result.current.token).toBe('GYM1.token1.sig');
    await advance(14_000);
    expect(result.current.token).toBe('GYM1.token1.sig');
    await advance(1_000);
    expect(result.current.token).toBeNull();
    expect(result.current.secondsLeft).toBe(0);
  });

  it('ignores an answer that arrives after unmount and stops asking', async () => {
    const { unmount } = renderHook(() => useCheckInToken(GYM));
    await advance(0);
    unmount();
    await advance(120_000);
    expect(tokenCalls()).toBe(1);
  });
});
