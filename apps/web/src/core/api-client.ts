import { useAuthStore } from './auth-store';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return fallback;
}

function authHeader(): Record<string, string> {
  const { accessToken } = useAuthStore.getState();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// Real auth (D-034) — a 401 tries exactly one silent refresh-and-retry
// before giving up and sending the user back to /login. This is the one
// place in the app that knows how to recover from an expired access token;
// every hook/page above this just sees a normal (or failed) response.
async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setTokens, clearAuth } = useAuthStore.getState();
  if (!refreshToken) return null;
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      clearAuth();
      return null;
    }
    const data = (await response.json()) as { accessToken: string; refreshToken: string };
    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearAuth();
    return null;
  }
}

function redirectToLogin(): never {
  useAuthStore.getState().clearAuth();
  window.location.href = '/login';
  throw new ApiError('Session expired', 401, null);
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeader(),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401 && !retried) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(path, init, true);
    }
    redirectToLogin();
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // No JSON body — fall back to the status text below.
    }
    throw new ApiError(extractMessage(body, response.statusText), response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// No Content-Type header here — the browser must set its own multipart
// boundary, which it can only do if we let it (setting one manually breaks
// the boundary the FormData body actually uses).
async function requestFile<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers: authHeader(), body: formData });
  if (response.status === 401) {
    redirectToLogin();
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // No JSON body — fall back to the status text below.
    }
    throw new ApiError(extractMessage(body, response.statusText), response.status, body);
  }
  return (await response.json()) as T;
}

export async function downloadFile(path: string, fileName: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeader() });
  if (response.status === 401) {
    redirectToLogin();
  }
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status, null);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// For inline display (e.g. an X-ray <img>), not download — a plain <img
// src="..."> can't send the Authorization header, so the bytes have to be
// fetched here and handed back as an object URL. Caller owns revoking it.
export async function fetchBlobUrl(path: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeader() });
  if (response.status === 401) {
    redirectToLogin();
  }
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status, null);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  postFile: <T>(path: string, formData: FormData) => requestFile<T>(path, formData),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  // A body on DELETE: G4.5d3c-3b2's line cancellation carries a MANDATORY
  // reason, and the route stayed DELETE because its semantics (remove this
  // charge from the bill) did not change — only its permanence did.
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) }),
};
