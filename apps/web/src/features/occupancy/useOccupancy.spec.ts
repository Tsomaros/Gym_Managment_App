import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GYM, json } from '../../test/fixtures';
import { useOccupancy } from './useOccupancy';

describe('useOccupancy', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let visibility: DocumentVisibilityState;

  const setVisibility = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    fetchMock = vi.fn<typeof fetch>(async () => json(200, { level: 'quiet' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const calls = () => fetchMock.mock.calls.map(([u]) => String(u));

  it('loads the occupancy of the gym right away', async () => {
    const { result } = renderHook(() => useOccupancy(GYM));
    await act(async () => {});
    expect(calls()).toEqual([`/api/gyms/${GYM}/occupancy`]);
    expect(result.current.occupancy).toEqual({ level: 'quiet' });
  });

  it('asks again after 60 seconds, and not before', async () => {
    renderHook(() => useOccupancy(GYM));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows the newest answer', async () => {
    const { result } = renderHook(() => useOccupancy(GYM));
    await act(async () => {});
    fetchMock.mockImplementation(async () => json(200, { level: 'busy' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.occupancy).toEqual({ level: 'busy' });
  });

  it('does not poll while the page is hidden, and refreshes at once when it comes back', async () => {
    renderHook(() => useOccupancy(GYM));
    await act(async () => {});
    setVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      setVisibility('visible');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops asking after it is unmounted', async () => {
    const { unmount } = renderHook(() => useOccupancy(GYM));
    await act(async () => {});
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the last answer when a later request fails, instead of blanking the badge', async () => {
    const { result } = renderHook(() => useOccupancy(GYM));
    await act(async () => {});
    fetchMock.mockImplementation(async () => json(500, {}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.occupancy).toEqual({ level: 'quiet' });
  });

  it('has no occupancy at all when the very first request fails', async () => {
    fetchMock.mockImplementation(async () => json(500, {}));
    const { result } = renderHook(() => useOccupancy(GYM));
    await act(async () => {});
    expect(result.current.occupancy).toBeNull();
  });

  it('starts over for another gym and drops the first gym’s answer', async () => {
    const OTHER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
    const { result, rerender } = renderHook(({ gym }) => useOccupancy(gym), {
      initialProps: { gym: GYM },
    });
    await act(async () => {});
    expect(result.current.occupancy).toEqual({ level: 'quiet' });
    // The other gym answers late: until then the first gym's answer must not be shown for it.
    let answer!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((res) => (answer = res)));
    rerender({ gym: OTHER });
    await act(async () => {});
    expect(calls().at(-1)).toBe(`/api/gyms/${OTHER}/occupancy`);
    expect(result.current.occupancy).toBeNull();
    await act(async () => answer(json(200, { level: 'busy' })));
    expect(result.current.occupancy).toEqual({ level: 'busy' });
  });

  it('ignores a slow answer of the first gym that arrives after the switch', async () => {
    const OTHER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
    let late!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => (late = res)));
    const { result, rerender } = renderHook(({ gym }) => useOccupancy(gym), {
      initialProps: { gym: GYM },
    });
    await act(async () => {});
    fetchMock.mockImplementation(async () => json(200, { level: 'quiet' }));
    rerender({ gym: OTHER });
    await act(async () => {});
    expect(result.current.occupancy).toEqual({ level: 'quiet' });
    await act(async () => late(json(200, { level: 'busy' })));
    expect(result.current.occupancy).toEqual({ level: 'quiet' });
  });
});
