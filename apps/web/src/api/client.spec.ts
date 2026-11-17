import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  getAccessToken,
  kioskFetch,
  onSignedOut,
  setAccessToken,
} from './client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('expired');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('sends the Bearer token and cookies to /api', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(apiFetch('/auth/me')).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/me');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer expired');
  });

  it('three parallel calls that get 401 share exactly one refresh, then all succeed', async () => {
    let refreshCalls = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => (releaseRefresh = r));

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        await refreshGate; // keep the refresh in flight until all three have seen their 401
        return json(200, { accessToken: 'fresh' });
      }
      const auth = new Headers(init?.headers).get('authorization');
      return auth === 'Bearer fresh' ? json(200, { url }) : json(401, { message: 'expired' });
    });

    const calls = Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')]);
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    releaseRefresh();

    await expect(calls).resolves.toEqual([{ url: '/api/a' }, { url: '/api/b' }, { url: '/api/c' }]);
    expect(refreshCalls).toBe(1);
    expect(getAccessToken()).toBe('fresh');
  });

  it('signs out when the refresh fails, and rejects with the 401', async () => {
    const signedOut = vi.fn();
    const unsubscribe = onSignedOut(signedOut);
    fetchMock.mockImplementation(async () => json(401, { message: 'nope' }));

    await expect(apiFetch('/a')).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    unsubscribe();
  });

  it('retries only once: a second 401 after a successful refresh signs out', async () => {
    const signedOut = vi.fn();
    const unsubscribe = onSignedOut(signedOut);
    fetchMock.mockImplementation(async (input) =>
      String(input) === '/api/auth/refresh'
        ? json(200, { accessToken: 'fresh' })
        : json(401, { message: 'still no' }),
    );

    await expect(apiFetch('/a')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === '/api/a')).toHaveLength(2);
    expect(signedOut).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('refreshes and retries /auth/me after its access token expired', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'fresh' });
      const auth = new Headers(init?.headers).get('authorization');
      return auth === 'Bearer fresh' ? json(200, { id: 'me' }) : json(401, {});
    });
    await expect(apiFetch('/auth/me')).resolves.toEqual({ id: 'me' });
  });

  it('does not try to refresh when signing in fails', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Invalid credentials' }));
    await expect(apiFetch('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes other errors through without refreshing', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { message: 'Forbidden' }));
    await expect(apiFetch('/a')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('kioskFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('user-token'); // a signed-in user in the same browser must not leak in
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('sends the device token, never the user token, and no cookies', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(kioskFetch('/kiosk/me', 'dev-1')).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/kiosk/me');
    expect(new Headers(init?.headers).get('authorization')).toBe('Device dev-1');
    expect(init?.credentials).toBe('omit'); // the user's refresh cookie must not travel
  });

  it('sends a JSON body with a content type, and no authorization before pairing', async () => {
    fetchMock.mockResolvedValueOnce(json(201, {}));
    await kioskFetch('/kiosk/pair', null, { method: 'POST', body: '{"code":"X"}' });
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
  });

  it('gives up on a request that never answers after 5 s (not before) and aborts it', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      fetchMock.mockImplementation((_url, init) => {
        signal = init?.signal;
        return new Promise<Response>(() => undefined);
      });
      let outcome: unknown = 'pending';
      void kioskFetch('/kiosk/me', 'dev-1').catch((e: unknown) => (outcome = e));
      await vi.advanceTimersByTimeAsync(4_999);
      expect(outcome).toBe('pending');
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).not.toBeInstanceOf(ApiError); // not a 401: the caller must not un-pair
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out a request that answered in time', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
      await expect(kioskFetch('/kiosk/me', 'dev-1')).resolves.toEqual({ ok: true });
      expect(vi.getTimerCount()).toBe(0); // the timeout was cleared
    } finally {
      vi.useRealTimers();
    }
  });

  it('on 401 throws ApiError without refreshing or signing anyone out', async () => {
    const signedOut = vi.fn();
    const off = onSignedOut(signedOut);
    fetchMock.mockResolvedValue(json(401, {}));
    await expect(kioskFetch('/kiosk/me', 'revoked')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no /auth/refresh
    expect(signedOut).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('user-token');
    off();
  });
});

describe('apiFetch with a file upload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('leaves the content type to the browser for FormData (it adds the multipart boundary)', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('t');
    const body = new FormData();
    body.set('photo', new Blob(['x'], { type: 'image/jpeg' }), 'photo.jpg');
    await apiFetch('/gyms/g/members/m/photo', { method: 'PUT', body });
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.has('content-type')).toBe(false);
    expect(headers.get('authorization')).toBe('Bearer t');
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(body);
  });
});
