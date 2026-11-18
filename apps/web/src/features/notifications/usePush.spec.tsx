import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '../../test/fixtures';
import { usePush } from './usePush';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

const SUB_JSON = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('usePush', () => {
  let calls: string[];
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let existing: {
    toJSON: () => unknown;
    unsubscribe: () => Promise<boolean>;
    endpoint: string;
  } | null;
  let subscribe: ReturnType<typeof vi.fn>;
  let resolveReady: (reg: unknown) => void;
  let permission: NotificationPermission;
  let requestPermission: ReturnType<typeof vi.fn>;

  function setup({ ua = ANDROID, standalone = false, supported = true } = {}) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: standalone && q.includes('standalone'),
      addEventListener() {},
      removeEventListener() {},
    }));
    if (!supported) {
      // iOS Safari outside the installed app has no PushManager at all.
      vi.stubGlobal('PushManager', undefined);
      vi.stubGlobal('Notification', undefined);
      Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
      return;
    }
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', {
      get permission() {
        return permission;
      },
      requestPermission,
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => existing),
        subscribe,
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: new Promise((resolve) => {
          resolveReady = () => {
            calls.push('ready');
            resolve(registration);
          };
        }),
      },
      configurable: true,
    });
  }

  beforeEach(() => {
    calls = [];
    existing = null;
    permission = 'default';
    requestPermission = vi.fn(async () => {
      calls.push('permission');
      permission = 'granted';
      return 'granted' as NotificationPermission;
    });
    subscribe = vi.fn(async () => {
      calls.push('subscribe');
      return { toJSON: () => SUB_JSON, endpoint: SUB_JSON.endpoint, unsubscribe: async () => true };
    });
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/push/vapid-public-key')) return json(200, { key: 'BAAB' });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('on an iPhone that has not installed the app the state is "needs-install"', () => {
    setup({ ua: IPHONE, supported: false });
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('needs-install');
  });

  it('on an iPhone running as the installed app (standalone) push is available', async () => {
    setup({ ua: IPHONE, standalone: true });
    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('default'));
  });

  it('a browser without push support is "unsupported"', () => {
    setup({ supported: false });
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('unsupported');
  });

  it('a blocked permission is "denied", and an existing subscription is "subscribed"', async () => {
    permission = 'denied';
    setup();
    expect(renderHook(() => usePush()).result.current.state).toBe('denied');
    permission = 'granted';
    existing = {
      toJSON: () => SUB_JSON,
      endpoint: SUB_JSON.endpoint,
      unsubscribe: async () => true,
    };
    setup();
    const { result } = renderHook(() => usePush());
    await act(async () => {
      resolveReady({});
    });
    await waitFor(() => expect(result.current.state).toBe('subscribed'));
  });

  it('enable asks for permission, waits for the service worker, then subscribes and registers with the API', async () => {
    setup();
    const { result } = renderHook(() => usePush());
    let done: Promise<void>;
    act(() => {
      done = result.current.enable();
    });
    await waitFor(() => expect(requestPermission).toHaveBeenCalled());
    // The service worker is not ready yet: nothing may subscribe.
    await new Promise((r) => setTimeout(r, 20));
    expect(subscribe).not.toHaveBeenCalled();
    await act(async () => {
      resolveReady({});
      await done;
    });
    expect(calls.indexOf('permission')).toBeLessThan(calls.indexOf('ready'));
    expect(calls.indexOf('ready')).toBeLessThan(calls.indexOf('subscribe'));
    // 'BAAB' is base64 for the bytes 0x04 0x00 0x01 (worked out by hand: 000001 000000 000000 000001).
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([4, 0, 1]),
    });
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(String(put[0])).toBe('/api/me/push-subscriptions');
    expect(JSON.parse(String(put[1]!.body))).toEqual(SUB_JSON);
    expect(result.current.state).toBe('subscribed');
  });

  it('a refused permission ends in "denied" with no subscription and no request to the API', async () => {
    requestPermission.mockImplementation(async () => {
      permission = 'denied';
      return 'denied' as NotificationPermission;
    });
    setup();
    const { result } = renderHook(() => usePush());
    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.state).toBe('denied');
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT')).toEqual([]);
  });

  it('dismissing the permission prompt leaves the state "default", so the person can try again', async () => {
    requestPermission.mockImplementation(async () => 'default' as NotificationPermission);
    setup();
    const { result } = renderHook(() => usePush());
    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.state).toBe('default');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('a failed registration with the API unsubscribes again and leaves the state "default"', async () => {
    const unsubscribe = vi.fn(async () => true);
    subscribe.mockImplementation(async () => ({
      toJSON: () => SUB_JSON,
      endpoint: SUB_JSON.endpoint,
      unsubscribe,
    }));
    fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith('/vapid-public-key')
        ? json(200, { key: 'BAAB' })
        : init?.method === 'PUT'
          ? json(400, {})
          : new Response(null, { status: 204 }),
    );
    setup();
    const { result } = renderHook(() => usePush());
    let done!: Promise<void>;
    act(() => {
      done = result.current.enable().catch(() => undefined);
    });
    await waitFor(() => expect(requestPermission).toHaveBeenCalled());
    await act(async () => {
      resolveReady({});
      await done;
    });
    expect(unsubscribe).toHaveBeenCalled();
    expect(result.current.state).toBe('default');
  });

  it('disable deletes the subscription at the API and unsubscribes the browser', async () => {
    // Like a real browser: once unsubscribed, getSubscription() answers null.
    const unsubscribe = vi.fn(async () => {
      existing = null;
      return true;
    });
    existing = { toJSON: () => SUB_JSON, endpoint: SUB_JSON.endpoint, unsubscribe };
    permission = 'granted';
    setup();
    const { result } = renderHook(() => usePush());
    await act(async () => {
      resolveReady({});
    });
    await waitFor(() => expect(result.current.state).toBe('subscribed'));
    await act(async () => {
      await result.current.disable();
    });
    const del = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!;
    expect(String(del[0])).toBe('/api/me/push-subscriptions');
    expect(JSON.parse(String(del[1]!.body))).toEqual({ endpoint: SUB_JSON.endpoint });
    expect(unsubscribe).toHaveBeenCalled();
    expect(result.current.state).toBe('default');
  });

  it('decodes a base64url key ("-" and "_", no padding) into the raw bytes', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/vapid-public-key')
        ? json(200, { key: '_-8' })
        : new Response(null, { status: 204 }),
    );
    setup();
    const { result } = renderHook(() => usePush());
    let done!: Promise<void>;
    act(() => {
      done = result.current.enable();
    });
    await waitFor(() => expect(requestPermission).toHaveBeenCalled());
    await act(async () => {
      resolveReady({});
      await done;
    });
    // '_-8' -> '/+8=' -> 111111 111110 111100 -> 0xFF 0xEF
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([0xff, 0xef]),
    });
  });

  it('is never "subscribed" for a browser that has permission but no subscription', async () => {
    permission = 'granted';
    setup();
    const { result } = renderHook(() => usePush());
    await act(async () => {
      resolveReady({});
    });
    expect(result.current.state).toBe('default');
  });
});
