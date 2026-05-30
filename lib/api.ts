// Fetch wrapper that:
//   - sends cookies (`credentials: 'include'`)
//   - normalizes the { ok, data } / { ok, error } envelope
//   - on 401, transparently calls /auth/refresh once and retries
//   - emits an `auth:expired` window event when refresh itself fails
//   - listens on BroadcastChannel('stampee-auth') for cross-tab logout
//
// Designed so the rest of the SPA only needs to call api.get/post/etc.

const rawApiUrl = import.meta.env.VITE_API_URL?.trim();
if (!rawApiUrl) {
  // eslint-disable-next-line no-console
  console.error('VITE_API_URL is not set. The SPA will not be able to reach the API.');
}
export const API_BASE = (rawApiUrl ?? '').replace(/\/+$/, '');

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.status = status;
    this.code = payload.code;
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Options {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

// Used by api.ts to remember when a refresh is already mid-flight so two
// concurrent 401-retries dedupe to a single /auth/refresh call.
let inFlightRefresh: Promise<boolean> | null = null;
const REFRESH_ENDPOINTS = new Set(['/auth/refresh', '/auth/me', '/auth/google', '/auth/google-staff']);

const buildUrl = (path: string, query?: Options['query']) => {
  const url = new URL(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
};

const sendOnce = async <T>(path: string, opts: Options): Promise<Response> => {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return fetch(buildUrl(path, opts.query), init);
};

const attemptRefresh = async (): Promise<boolean> => {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const res = await sendOnce('/auth/refresh', { method: 'POST', body: {} });
      return res.ok;
    } catch {
      return false;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
};

const parseEnvelope = async <T>(res: Response): Promise<T> => {
  let payload: { ok?: boolean; data?: T; error?: ApiErrorPayload } | null = null;
  if (res.status !== 204) {
    try {
      payload = await res.json();
    } catch {
      // fall through
    }
  }
  if (!res.ok || !payload || payload.ok === false) {
    const err = payload?.error ?? {
      code: 'NETWORK',
      message: `Request failed: ${res.status} ${res.statusText}`,
    };
    throw new ApiError(res.status, err);
  }
  return (payload.data ?? (undefined as unknown)) as T;
};

export const apiFetch = async <T>(path: string, opts: Options = {}): Promise<T> => {
  let res = await sendOnce<T>(path, opts);
  if (res.status === 401 && !REFRESH_ENDPOINTS.has(path)) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      res = await sendOnce<T>(path, opts);
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
  }
  return parseEnvelope<T>(res);
};

export const api = {
  get: <T>(path: string, query?: Options['query'], signal?: AbortSignal) =>
    apiFetch<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown, query?: Options['query']) =>
    apiFetch<T>(path, { method: 'POST', body: body ?? {}, query }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'DELETE', body: body ?? {} }),
};

// --- Cross-tab auth coordination ------------------------------------------
// One BroadcastChannel per tab. When one tab logs out, all tabs clear local
// state and redirect to /login. We use a string channel name so a fresh fork
// without this file still works in isolation.
type AuthBroadcast = { type: 'logout' } | { type: 'login' };
let broadcastChannel: BroadcastChannel | null = null;
const getChannel = (): BroadcastChannel | null => {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) broadcastChannel = new BroadcastChannel('stampee-auth');
  return broadcastChannel;
};

export const broadcastAuth = (message: AuthBroadcast) => {
  getChannel()?.postMessage(message);
};

export const onAuthBroadcast = (handler: (msg: AuthBroadcast) => void): (() => void) => {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (ev: MessageEvent<AuthBroadcast>) => handler(ev.data);
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
};
