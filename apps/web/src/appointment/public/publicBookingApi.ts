/**
 * THE PUBLIC BOOKING CLIENT — deliberately NOT `apiClient`.
 *
 * `apiClient` attaches the staff bearer token and, on a 401, tries a silent
 * refresh and then redirects to /login. Every one of those behaviours is wrong
 * here: a patient has no session, and a booking page that bounced somebody to
 * a staff login screen would be worse than useless.
 *
 * So this is a bare fetch against the same origin, with no credentials of any
 * kind. If a staff member happens to be signed in on the same browser, their
 * token is still not sent — the public path must behave identically for
 * everyone.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export class PublicBookingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PublicBookingError';
  }
}

/**
 * Phase 6 — an uploaded image comes back as a RELATIVE API path
 * (`/public/booking/:slug/media/:id`); an <img> on the web origin needs the
 * API origin in front of it. External http(s) URLs pass through untouched.
 */
export function publicMediaSrc(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/public/booking${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? Array.isArray(body.message)
          ? body.message.join('; ')
          : String(body.message)
        : null) ?? 'Something went wrong. Please try again.';
    throw new PublicBookingError(message, response.status);
  }
  return body as T;
}

export interface PublicService {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  photoUrl: string | null;
  durationMinutes: number;
  price: { display: string; amount: string } | null;
  bookingFee: string;
  paymentRule: string;
  depositAmount: string;
  requiresApproval: boolean;
  preInstructions: string | null;
  slug: string | null;
}

export interface PublicPage {
  clinic: {
    slug: string;
    displayName: string;
    logoUrl: string | null;
    language: string;
    introText: string | null;
    timeZone: string;
  };
  form: {
    requirePhone: boolean;
    requireEmail: boolean;
    requireNric: boolean;
    showReasonField: boolean;
  };
  selectedServiceId: string | null;
  services: PublicService[];
}

export interface PublicSlot {
  start: string;
  end: string;
  staffId: string;
}

export interface PublicFormField {
  id: string;
  label: string;
  helpText: string | null;
  fieldType: string;
  required: boolean;
  options: string[];
  sortOrder: number;
}

export const publicBooking = {
  page: (slug: string, serviceSlug?: string) =>
    request<PublicPage>(`/${slug}${serviceSlug ? `?service=${encodeURIComponent(serviceSlug)}` : ''}`),
  providers: (slug: string, serviceId: string) =>
    request<{ id: string; fullName: string; professionalType?: string | null }[]>(
      `/${slug}/providers?serviceId=${serviceId}`,
    ),
  availability: (slug: string, params: { serviceId: string; date: string; staffId?: string }) =>
    request<{ timeZone: string; reason: string | null; slots: PublicSlot[] }>(
      `/${slug}/availability?serviceId=${params.serviceId}&date=${params.date}${
        params.staffId ? `&staffId=${params.staffId}` : ''
      }`,
    ),
  formFields: (slug: string, serviceId: string) =>
    request<PublicFormField[]>(`/${slug}/form-fields?serviceId=${serviceId}`),
  book: (slug: string, body: Record<string, unknown>) =>
    request<{
      status: string;
      scheduledStart: string;
      scheduledEnd: string;
      manageToken: string;
      manageUrl: string;
      message: string;
    }>(`/${slug}/book`, { method: 'POST', body: JSON.stringify(body) }),
  manage: (slug: string, token: string) =>
    request<{
      clinic: { displayName: string; logoUrl: string | null; timeZone: string };
      appointment: {
        status: string;
        scheduledStart: string;
        scheduledEnd: string;
        serviceName: string;
        providerName: string;
        patientName: string;
        note: string | null;
        paymentStatus: string;
        bookingFeeAmount: string;
        preInstructions: string | null;
        postInstructions: string | null;
        answers: { label: string; answer: string | null }[];
      };
      can: { reschedule: boolean; cancel: boolean };
      policy: {
        reschedule: 'NOT_ALLOWED' | 'REQUEST_APPROVAL' | 'INSTANT';
        cancel: 'NOT_ALLOWED' | 'REQUEST_APPROVAL' | 'INSTANT';
        cutoffMinutes: number;
        changeable: boolean;
      };
      pendingRequests: {
        id: string;
        type: 'RESCHEDULE' | 'CANCELLATION';
        reason: string;
        requestedStart: string | null;
        requestedEnd: string | null;
        createdAt: string;
      }[];
      lastDecision: {
        type: 'RESCHEDULE' | 'CANCELLATION';
        status: 'APPROVED' | 'DECLINED';
        decisionNote: string | null;
        decidedAt: string | null;
      } | null;
      cutoffHours: number;
      confirmationMessage: string | null;
    }>(`/${slug}/manage/${token}`),
  requestChange: (
    slug: string,
    token: string,
    body: {
      type: 'RESCHEDULE' | 'CANCELLATION';
      reason: string;
      scheduledStart?: string;
      scheduledEnd?: string;
    },
  ) =>
    request<{ requested: boolean; requestId: string }>(
      `/${slug}/manage/${token}/request-change`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  cancelByToken: (slug: string, token: string, reason?: string) =>
    request<{ cancelled: boolean }>(`/${slug}/manage/${token}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),
  availabilityForToken: (slug: string, token: string, date: string) =>
    request<{ timeZone: string; reason: string | null; slots: PublicSlot[] }>(
      `/${slug}/manage/${token}/availability?date=${date}`,
    ),
  rescheduleByToken: (
    slug: string,
    token: string,
    body: { scheduledStart: string; scheduledEnd: string },
  ) =>
    request<{ manageToken: string }>(`/${slug}/manage/${token}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
