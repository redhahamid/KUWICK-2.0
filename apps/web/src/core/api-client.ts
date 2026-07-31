import { useTenantStore } from './tenant-store';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { tenantId } = useTenantStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (tenantId) {
    headers['x-tenant-id'] = tenantId;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

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
  const { tenantId } = useTenantStore.getState();
  const headers: Record<string, string> = {};
  if (tenantId) {
    headers['x-tenant-id'] = tenantId;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: formData });
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
  const { tenantId } = useTenantStore.getState();
  const headers: Record<string, string> = {};
  if (tenantId) {
    headers['x-tenant-id'] = tenantId;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
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
// src="..."> can't send the x-tenant-id header, so the bytes have to be
// fetched here and handed back as an object URL. Caller owns revoking it.
export async function fetchBlobUrl(path: string): Promise<string> {
  const { tenantId } = useTenantStore.getState();
  const headers: Record<string, string> = {};
  if (tenantId) {
    headers['x-tenant-id'] = tenantId;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
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
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
