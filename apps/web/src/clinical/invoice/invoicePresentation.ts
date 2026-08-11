import { ClaimLineStatus, Invoice, InvoiceLine, InvoiceStatus, Visit } from '../types';

/**
 * G3c (D-065) — how a visit's invoice describes itself to a doctor.
 *
 * Every value here comes from a field the backend actually stores. Where the
 * model has nothing — there is no tax/SST column, no discount column, and no
 * partial-payment concept — nothing is displayed and nothing is invented.
 * The backend's `totalAmount` is the source of truth; this file never
 * recomputes a second independent total from the lines.
 */

export function money(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0);
  return `RM ${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Status
//
// The enum has exactly three values: UNPAID, PAID, CANCELLED. There is no
// DRAFT and no PARTIALLY_PAID — `pay()` is all-or-nothing and stamps
// `paidAt` once — so neither is offered here. Inventing "Partially Paid"
// from patientPaidAmount < totalAmount would be wrong: on a panel invoice
// the patient legitimately pays only the copay and the invoice is fully PAID.
// ---------------------------------------------------------------------------
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  UNPAID: 'Unpaid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

export const INVOICE_STATUS_COLOR: Record<InvoiceStatus, string> = {
  UNPAID: 'gold',
  PAID: 'green',
  CANCELLED: 'default',
};

// The panel-claim lifecycle is a SEPARATE fact from whether the patient paid.
// An invoice can be PAID (patient settled their copay) while its claim is
// still PENDING with the panel. Shown as its own badge, never merged.
export const CLAIM_STATUS_LABEL: Record<ClaimLineStatus, string> = {
  PENDING: 'Claim pending',
  ACCEPTED: 'Claim accepted',
  REJECTED: 'Claim rejected',
  DEDUCTED: 'Claim deducted',
  PAID: 'Claim paid',
};

export const CLAIM_STATUS_COLOR: Record<ClaimLineStatus, string> = {
  PENDING: 'blue',
  ACCEPTED: 'cyan',
  REJECTED: 'red',
  DEDUCTED: 'orange',
  PAID: 'green',
};

/** The current claim line, if this invoice has ever been claimed. */
export function currentClaim(invoice: Invoice) {
  return invoice.claimBatchLines?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Billing classification
//
// The panel lives on the VISIT, not the invoice. `billingType` is free text
// ("Cash", "Panel", …) and `panelClinicId` is the structured truth, so the
// structured field decides and the panel's own name is shown when resolved.
// ---------------------------------------------------------------------------
export interface BillingClassification {
  isPanel: boolean;
  label: string;
  panelName: string | null;
}

export function billingClassification(invoice: Invoice, visit: Visit): BillingClassification {
  const panelName = invoice.visit?.panelClinic?.name ?? visit.panelClinic?.name ?? null;
  const isPanel = Boolean(invoice.visit?.panelClinicId ?? visit.panelClinicId);
  if (!isPanel) return { isPanel: false, label: 'Cash', panelName: null };
  return { isPanel: true, label: panelName ? `Panel · ${panelName}` : 'Panel', panelName };
}

// ---------------------------------------------------------------------------
// Money
//
// `panelCoveredAmount`/`patientPaidAmount` are snapshotted by the backend AT
// PAY TIME and are 0/0 while an invoice is UNPAID. Showing "Panel covered
// RM0.00" on an unpaid panel invoice would read as "the panel pays nothing",
// which is false — so the split is only reported once it is a recorded fact.
// ---------------------------------------------------------------------------
export interface InvoiceMoney {
  total: number;
  /** Recorded receipts. Zero until the invoice is paid. */
  received: number;
  outstanding: number;
  /** Present only once the pay step has snapshotted the split. */
  split: { panelCovered: number; patientPaid: number } | null;
}

export function invoiceMoney(invoice: Invoice): InvoiceMoney {
  const total = Number(invoice.totalAmount);
  if (invoice.status === 'PAID') {
    const panelCovered = Number(invoice.panelCoveredAmount);
    const patientPaid = Number(invoice.patientPaidAmount);
    return {
      total,
      received: panelCovered + patientPaid,
      outstanding: 0,
      split: { panelCovered, patientPaid },
    };
  }
  // A cancelled invoice is not money owed.
  if (invoice.status === 'CANCELLED') {
    return { total, received: 0, outstanding: 0, split: null };
  }
  return { total, received: 0, outstanding: total, split: null };
}

// ---------------------------------------------------------------------------
// Line source
//
// Taken ONLY from the stored relationship. A line typed by hand has no source
// and is shown neutrally rather than guessed at from its wording — "Panadol"
// in a description does not make a line a medication.
// ---------------------------------------------------------------------------
export type LineSource = 'MEDICATION' | 'PROCEDURE' | 'SERVICE' | 'ITEM';

export interface LineSourceInfo {
  kind: LineSource | null;
  label: string | null;
  color: string | null;
}

export function lineSource(line: InvoiceLine): LineSourceInfo {
  if (line.sourcePrescription) {
    return { kind: 'MEDICATION', label: 'Medication', color: 'purple' };
  }
  if (line.sourceOrderService) {
    return line.sourceOrderService.orderType === 'TASK_ORDER'
      ? { kind: 'PROCEDURE', label: 'Procedure', color: 'blue' }
      : { kind: 'SERVICE', label: 'Service', color: 'geekblue' };
  }
  return { kind: null, label: null, color: null };
}

// ---------------------------------------------------------------------------
// Collapsed summary
//
// "Invoice INV-00124 · RM85.00 · Unpaid · Cash". With more than one invoice
// on the visit — which the schema permits, there is no unique constraint on
// visitId — the line says so rather than silently reporting only the newest.
// ---------------------------------------------------------------------------
export function collapsedSummary(invoices: Invoice[], visit: Visit): string {
  if (invoices.length === 0) return '';
  const latest = invoices[0];
  const billing = billingClassification(latest, visit);
  const parts = [
    `Invoice ${latest.invoiceNumber}`,
    money(latest.totalAmount),
    INVOICE_STATUS_LABEL[latest.status],
    billing.label,
  ];
  if (invoices.length > 1) parts.push(`+${invoices.length - 1} more on this visit`);
  return parts.join(' · ');
}
