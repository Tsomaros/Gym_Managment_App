/**
 * The one way the web app talks to the API. Every path is sent to `/api<path>` (same origin, so the
 * SameSite=Strict refresh cookie travels). On a 401 it refreshes once, shared by every caller that
 * hit the 401 at the same time (and across tabs, through a Web Lock), retries once, otherwise signs out.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const signedOutListeners = new Set<() => void>();

export const getAccessToken = (): string | null => accessToken;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Called when the session can't be renewed. Returns an unsubscribe function. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

function signOut(): void {
  accessToken = null;
  for (const listener of signedOutListeners) listener();
}

async function postRefresh(): Promise<boolean> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) return false;
  const body = (await res.json()) as { accessToken: string };
  accessToken = body.accessToken;
  return true;
}

/**
 * Renews the access token with the refresh cookie. Concurrent callers share one request. The Web Lock
 * serialises tabs: a second tab waits, then refreshes with the cookie the first tab already rotated,
 * instead of replaying the old one (which the API treats as theft and revokes the session).
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      return locks ? await locks.request('gym-auth-refresh', postRefresh) : await postRefresh();
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  // A FormData body (a photo) needs the browser's own multipart content type, with its boundary.
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Calls made by a paired kiosk tablet: authorised by its device token, never by a user. No
 * cookies, no refresh and no sign-out; a 401 means the tablet was revoked and is the caller's to
 * handle.
 */
export const KIOSK_TIMEOUT_MS = 5000;

export async function kioskFetch<T>(
  path: string,
  deviceToken: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (deviceToken) headers.set('authorization', `Device ${deviceToken}`);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  // A hung request must not freeze the tablet: give up and let the caller show "connection problem".
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error('kiosk request timed out'));
    }, KIOSK_TIMEOUT_MS);
  });
  let res: Response;
  try {
    res = await Promise.race([
      fetch(`/api${path}`, { ...init, headers, credentials: 'omit', signal: abort.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError(res.status, await parse<unknown>(res).catch(() => undefined));
  return parse<T>(res);
}

/** Auth calls that don't use the access token: a 401 there is the answer, not an expired token. */
const NO_REFRESH =
  /^\/auth\/(login|refresh|logout|accept-invite|invitations\/|signup|verify-email)/;

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !NO_REFRESH.test(path)) {
    if (await refreshSession()) res = await send(path, init);
    if (res.status === 401) signOut();
  }
  if (!res.ok) throw new ApiError(res.status, await parse<unknown>(res).catch(() => undefined));
  return parse<T>(res);
}
