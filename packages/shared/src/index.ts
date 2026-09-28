// Types shared by apps/web and apps/api. Defined once here so the two
// sides can never drift out of sync — see docs/CODING_STANDARDS.md §3.

export enum Role {
  OWNER_ADMIN = 'OWNER_ADMIN',
  DOCTOR_RESIDENT = 'DOCTOR_RESIDENT',
  DOCTOR_LOCUM = 'DOCTOR_LOCUM',
  FRONT_DESK_CLINICAL_STAFF = 'FRONT_DESK_CLINICAL_STAFF',
  FINANCE_STAFF = 'FINANCE_STAFF',
  HR_STAFF = 'HR_STAFF',
  CLINIC_MANAGER = 'CLINIC_MANAGER',
  STOCK_STAFF = 'STOCK_STAFF',
  PANEL_STAFF = 'PANEL_STAFF',
  PATIENT_PORTAL = 'PATIENT_PORTAL',
}

// Semantic status color families — see docs/UI_DESIGN_SYSTEM.md §2.
// Every lifecycle status below must map to exactly one of these.
export type StatusTone =
  | 'success'
  | 'active'
  | 'attention'
  | 'warning'
  | 'error'
  | 'neutral'
  // V2 semantic additions (docs/DECISIONS.md, D-105): the clinical
  // teal for in-the-building states, and violet for requested/planned.
  | 'clinical'
  | 'planned';

/**
 * Mirrors the Prisma enum exactly (apps/api/prisma/schema.prisma) — Prisma
 * cannot import a TS enum from another package, so the two are kept in step by
 * hand rather than redefining the wording.
 *
 * The last three are DEPRECATED: nothing writes them any more, and they remain
 * only so that rows written before the scheduling redesign stay readable. See
 * `DEPRECATED_APPOINTMENT_STATUSES`.
 */
export enum AppointmentStatus {
  REQUESTED = 'REQUESTED',
  CONFIRMED = 'CONFIRMED',
  ARRIVED = 'ARRIVED',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  WAITLIST = 'WAITLIST',
  REMINDED = 'REMINDED',
  RESCHEDULED = 'RESCHEDULED',
  IN_QUEUE = 'IN_QUEUE',
}

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  // One status language everywhere (§5 of the V2 design direction):
  // requested is PLANNED (violet), arrived is ATTENTION (amber — somebody is
  // physically waiting at the desk), in-the-building states are CLINICAL
  // (teal), a no-show is WARNING (it is a fact to follow up, not an error
  // the clinic made), and cancelled stays the soft red of a released slot.
  [AppointmentStatus.REQUESTED]: 'planned',
  [AppointmentStatus.CONFIRMED]: 'active',
  [AppointmentStatus.ARRIVED]: 'attention',
  [AppointmentStatus.CHECKED_IN]: 'clinical',
  [AppointmentStatus.COMPLETED]: 'success',
  [AppointmentStatus.CANCELLED]: 'error',
  [AppointmentStatus.NO_SHOW]: 'warning',
  [AppointmentStatus.WAITLIST]: 'neutral',
  [AppointmentStatus.REMINDED]: 'active',
  [AppointmentStatus.RESCHEDULED]: 'neutral',
  [AppointmentStatus.IN_QUEUE]: 'clinical',
};

/**
 * WHAT A PERSON READS. The enum value is a stored fact; this is the word on
 * the chip, and the two are allowed to differ — "Checked in" reads better than
 * CHECKED_IN and survives the enum being renamed.
 */
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  [AppointmentStatus.REQUESTED]: 'Requested',
  [AppointmentStatus.CONFIRMED]: 'Confirmed',
  [AppointmentStatus.ARRIVED]: 'Arrived',
  [AppointmentStatus.CHECKED_IN]: 'Checked in',
  [AppointmentStatus.COMPLETED]: 'Completed',
  [AppointmentStatus.CANCELLED]: 'Cancelled',
  [AppointmentStatus.NO_SHOW]: 'No-show',
  [AppointmentStatus.WAITLIST]: 'Waitlist',
  [AppointmentStatus.REMINDED]: 'Confirmed',
  [AppointmentStatus.RESCHEDULED]: 'Rescheduled',
  [AppointmentStatus.IN_QUEUE]: 'Checked in',
};

/**
 * Statuses no code path writes any more, kept so no historical row becomes
 * unreadable. A screen must still render them; nothing must produce them.
 */
export const DEPRECATED_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.REMINDED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.IN_QUEUE,
];

export enum ProcurementRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CONVERTED = 'CONVERTED',
}

export const PROCUREMENT_REQUEST_STATUS_TONE: Record<ProcurementRequestStatus, StatusTone> = {
  [ProcurementRequestStatus.PENDING]: 'attention',
  [ProcurementRequestStatus.APPROVED]: 'active',
  [ProcurementRequestStatus.REJECTED]: 'error',
  [ProcurementRequestStatus.CONVERTED]: 'success',
};

export enum PurchaseOrderStatus {
  ORDERED = 'ORDERED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED = 'FULLY_RECEIVED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export const PURCHASE_ORDER_STATUS_TONE: Record<PurchaseOrderStatus, StatusTone> = {
  [PurchaseOrderStatus.ORDERED]: 'attention',
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: 'active',
  [PurchaseOrderStatus.FULLY_RECEIVED]: 'success',
  [PurchaseOrderStatus.CLOSED]: 'neutral',
  [PurchaseOrderStatus.CANCELLED]: 'error',
};

/**
 * THE CURATED PROVIDER IDENTITY PALETTE (approved design decision 2).
 *
 * Provider colour answers WHO the provider is. Status colour answers WHAT is
 * happening to the appointment. The two systems are kept apart deliberately:
 * a card may carry one provider hue and one status hue, never more, and a
 * provider hue is never a status and never a full-card fill.
 *
 * Eight colours, hand-picked rather than generated, because a generated ramp
 * cannot promise three things this one does:
 *   - exactly ONE blue, so a clinic running a single busy doctor can never
 *     turn the diary into a wall of blue again;
 *   - every `text` value readable on white, so a doctor's name can carry the
 *     colour instead of relying on a dot alone;
 *   - `pastel` weak enough to sit under text at any card width.
 *
 * Shared between apps/api (which VALIDATES writes against it — the server,
 * not the form, is what makes "curated palette only" true) and apps/web
 * (which renders it). Defined once so the two can never drift.
 */
export type ProviderColorName =
  | 'TEAL'
  | 'EMERALD'
  | 'SKY'
  | 'INDIGO'
  | 'VIOLET'
  | 'ROSE'
  | 'AMBER'
  | 'SLATE';

export interface ProviderColor {
  name: ProviderColorName;
  /** The human word an owner picks by. */
  label: string;
  /** Identity edge, avatar ring, status-free dot. The stored value. */
  accent: string;
  /** Gutter band, month chip ground, avatar ground. Never a body fill. */
  pastel: string;
  /** The accent darkened until it reads as text on white. */
  text: string;
}

export const PROVIDER_COLORS: ProviderColor[] = [
  { name: 'TEAL', label: 'Teal', accent: '#0F6B78', pastel: '#E7F3F4', text: '#0B535D' },
  { name: 'EMERALD', label: 'Emerald', accent: '#2F8B57', pastel: '#E8F4ED', text: '#24693F' },
  { name: 'SKY', label: 'Sky', accent: '#2E7BC4', pastel: '#E8F1FA', text: '#235F99' },
  { name: 'INDIGO', label: 'Indigo', accent: '#4A57C4', pastel: '#ECEEFB', text: '#3A45A5' },
  { name: 'VIOLET', label: 'Violet', accent: '#7A4FBF', pastel: '#F2ECFB', text: '#62409A' },
  { name: 'ROSE', label: 'Rose', accent: '#B4506B', pastel: '#FBECEF', text: '#8F3F55' },
  { name: 'AMBER', label: 'Amber', accent: '#A96A12', pastel: '#FBF1E2', text: '#8A560F' },
  // Reserved for the neutral cases — a locum, an unassigned column, "any
  // available doctor" — so the neutral case has its own slot instead of
  // borrowing a hue that means somebody.
  { name: 'SLATE', label: 'Slate', accent: '#55627A', pastel: '#EEF0F4', text: '#414D63' },
];

/** The stored form: the accent hex, upper-case, as written to Staff.calendarColor. */
export const PROVIDER_COLOR_VALUES: string[] = PROVIDER_COLORS.map((color) => color.accent);

/**
 * Is this a colour an owner is allowed to store? The API answers with this
 * rather than a hex regex — "any valid hex" would be a free-form colour
 * picker with extra steps, which the approved design rules out.
 */
export function isProviderColor(value: string | null | undefined): boolean {
  if (!value) return false;
  return PROVIDER_COLOR_VALUES.includes(value.toUpperCase());
}

export function providerColorByAccent(accent: string | null | undefined): ProviderColor | undefined {
  if (!accent) return undefined;
  const wanted = accent.toUpperCase();
  return PROVIDER_COLORS.find((color) => color.accent === wanted);
}

/**
 * The colour a NEW provider is given when nobody picked one.
 *
 * First curated colour not already spoken for in this clinic, so a clinic's
 * first eight providers are guaranteed visually distinct — which is the whole
 * point of the identity system, and is exactly what a hash cannot promise
 * (six random ids into six slots land all-distinct about 1.5% of the time).
 * Past eight, it reuses in order: SLATE is skipped while anything else is
 * free, because the neutral slot reads as "no particular provider".
 */
export function nextProviderColor(taken: (string | null | undefined)[]): string {
  const used = new Set(
    taken.filter((value): value is string => Boolean(value)).map((value) => value.toUpperCase()),
  );
  const preferred = PROVIDER_COLORS.filter((color) => color.name !== 'SLATE');
  const free = preferred.find((color) => !used.has(color.accent));
  if (free) return free.accent;
  const anyFree = PROVIDER_COLORS.find((color) => !used.has(color.accent));
  if (anyFree) return anyFree.accent;
  return preferred[used.size % preferred.length].accent;
}
