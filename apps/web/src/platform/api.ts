import { usePlatformAuthStore } from '../core/platform-auth-store';
import { ApiError } from '../core/api-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

// Platform console's own API client — separate from apiClient on purpose:
// it reads the platform-admin token (not the clinic-staff one) and has no
// refresh flow (platform tokens are single 1h sessions; an expired one just
// sends the owner back to /platform/login).
export async function platformRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { accessToken, clearAuth } = usePlatformAuthStore.getState();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (response.status === 401) {
    clearAuth();
    window.location.href = '/platform/login';
    throw new ApiError('Session expired', 401, null);
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const platformApi = {
  get: <T>(path: string) => platformRequest<T>(path),
  post: <T>(path: string, body?: unknown) =>
    platformRequest<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    platformRequest<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    platformRequest<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => platformRequest<T>(path, { method: 'DELETE' }),
};
