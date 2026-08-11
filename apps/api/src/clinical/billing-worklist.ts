import { InvoiceStatus, OrderServiceStatus, PrescriptionStatus, PrescriptionSupplyMode } from '@prisma/client';
import { ClinicalTx } from './clinical-actor';
import { resolveConsultationState } from './consultation-tariff';

/**
 * G4.5d3c-3b1 (D-093), reworked for 3b2 (D-094) — the source-aware billing
 * worklist: every billing-relevant source record with its state, correct
 * whether or not invoices already exist. The Billing Review screen renders
 * exactly this; it re-derives nothing.
 *
 * STATES (owner's source item rules):
 *
 *   Prescriptions —
 *     DISPENSED + ONSITE_DISPENSE            READY (finalisable charge)
 *     ORDERED   + ONSITE_DISPENSE            AWAITING_DISPENSE (chargeable
 *                                            work, but no final charge action
 *                                            until dispensing happens — v1
 *                                            has no partial dispensing)
 *     DEFERRED / NULL supply mode            UNRESOLVED_SUPPLY
 *     EXTERNAL / PATIENT_OWN / NO_SUPPLY     NOT_CHARGEABLE (listed with the
 *                                            reason, so the screen can say
 *                                            WHY there is no charge)
 *     CANCELLED / soft-deleted               omitted entirely
 *
 *   Orders —
 *     TASK_ORDER COMPLETED                   READY
 *     TASK_ORDER PENDING/IN_PROGRESS         NOT_READY
 *     STANDARD_SERVICE (non-cancelled)       READY
 *     CANCELLED                              NOT_CHARGEABLE
 *
 *   Consultation — one synthetic item (sourceId = visitId) from the tariff
 *   resolver: READY / TARIFF_REVIEW / WAIVED / billed / EXEMPT. Omitted when
 *   the clinic has no tariff configured or no consultation occurred.
 *
 * BILLED means an ACTIVE line (not cancelled) on a non-CANCELLED invoice
 * references the source — on ANY invoice of the visit.
 *
 * QUANTITY is the SERVER-SIDE source quantity (owner decision 10): the
 * prescription's quantity, 1 for orders and consultation. The client never
 * chooses a sourced quantity.
 */
export type BillingWorklistSourceType = 'PRESCRIPTION' | 'ORDER_SERVICE' | 'CONSULTATION';

export type BillingWorklistState =
  | 'READY'
  | 'AWAITING_DISPENSE'
  | 'UNRESOLVED_SUPPLY'
  | 'NOT_READY'
  | 'NOT_CHARGEABLE'
  | 'TARIFF_REVIEW'
  | 'WAIVED';

export interface BillingWorklistItem {
  sourceType: BillingWorklistSourceType;
  sourceId: string;
  description: string;
  state: BillingWorklistState;
  /** Human wording for WHY the item is in its state (shown by the UI as-is). */
  stateReason: string | null;
  /** The source's own clinical/operational status (ORDERED, COMPLETED, ...). */
  sourceStatus: string | null;
  supplyMode: string | null;
  billed: boolean;
  invoiceLineId: string | null;
  quantity: number | null;
}

const NOT_CHARGEABLE_REASON: Partial<Record<PrescriptionSupplyMode, string>> = {
  [PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION]: 'Prescribed to an external pharmacy — not a clinic medication charge.',
  [PrescriptionSupplyMode.PATIENT_OWN_SUPPLY]: "Patient uses their own supply — not a clinic medication charge.",
  [PrescriptionSupplyMode.NO_SUPPLY_REQUIRED]: 'No supply required — no medication charge.',
};

export async function collectBillingWorklist(tx: ClinicalTx, visitId: string): Promise<BillingWorklistItem[]> {
  const [prescriptions, orders, activeLines] = await Promise.all([
    tx.prescription.findMany({
      where: { visitId, deletedAt: null, status: { not: PrescriptionStatus.CANCELLED } },
      select: {
        id: true,
        quantity: true,
        supplyMode: true,
        status: true,
        item: { select: { name: true } },
      },
      orderBy: { prescribedAt: 'asc' },
    }),
    tx.orderService.findMany({
      where: { visitId },
      select: { id: true, procedureName: true, orderType: true, status: true },
      orderBy: { requestedAt: 'asc' },
    }),
    tx.invoiceLine.findMany({
      where: {
        cancelledAt: null,
        invoice: { visitId, status: { not: InvoiceStatus.CANCELLED } },
        OR: [{ sourcePrescriptionId: { not: null } }, { sourceOrderServiceId: { not: null } }],
      },
      select: { id: true, sourcePrescriptionId: true, sourceOrderServiceId: true },
    }),
  ]);

  const lineByPrescription = new Map(
    activeLines.filter((l) => l.sourcePrescriptionId).map((l) => [l.sourcePrescriptionId as string, l.id]),
  );
  const lineByOrder = new Map(
    activeLines.filter((l) => l.sourceOrderServiceId).map((l) => [l.sourceOrderServiceId as string, l.id]),
  );

  const items: BillingWorklistItem[] = [];

  for (const prescription of prescriptions) {
    const mode = prescription.supplyMode;
    const lineId = lineByPrescription.get(prescription.id) ?? null;
    const base = {
      sourceType: 'PRESCRIPTION' as const,
      sourceId: prescription.id,
      description: prescription.item?.name ?? 'Medication',
      sourceStatus: prescription.status,
      supplyMode: mode,
      billed: lineId !== null,
      invoiceLineId: lineId,
      quantity: prescription.quantity,
    };
    if (mode && NOT_CHARGEABLE_REASON[mode]) {
      items.push({ ...base, state: 'NOT_CHARGEABLE', stateReason: NOT_CHARGEABLE_REASON[mode] ?? null });
      continue;
    }
    if (mode === null || mode === PrescriptionSupplyMode.DEFERRED) {
      items.push({
        ...base,
        state: 'UNRESOLVED_SUPPLY',
        stateReason:
          mode === PrescriptionSupplyMode.DEFERRED
            ? 'Deferred medication supply must be resolved by the prescriber.'
            : 'Medication supply mode has not been confirmed.',
      });
      continue;
    }
    // ONSITE_DISPENSE — the only clinic medication charge (owner decision 4).
    // Finalisable only once DISPENSED: v1 bills what was actually supplied.
    if (prescription.status === PrescriptionStatus.DISPENSED) {
      items.push({ ...base, state: 'READY', stateReason: null });
    } else {
      items.push({
        ...base,
        state: 'AWAITING_DISPENSE',
        stateReason: 'Awaiting dispensing — the charge is finalised from what is actually supplied.',
      });
    }
  }

  for (const order of orders) {
    const lineId = lineByOrder.get(order.id) ?? null;
    const base = {
      sourceType: 'ORDER_SERVICE' as const,
      sourceId: order.id,
      description: order.procedureName,
      sourceStatus: order.status,
      supplyMode: null,
      billed: lineId !== null,
      invoiceLineId: lineId,
      quantity: 1,
    };
    if (order.status === OrderServiceStatus.CANCELLED) {
      items.push({ ...base, state: 'NOT_CHARGEABLE', stateReason: 'Cancelled — not chargeable.' });
      continue;
    }
    if (order.orderType === 'TASK_ORDER' && order.status !== OrderServiceStatus.COMPLETED) {
      items.push({
        ...base,
        state: 'NOT_READY',
        stateReason: 'The procedure has not been completed yet.',
      });
      continue;
    }
    items.push({ ...base, state: 'READY', stateReason: null });
  }

  // --- Consultation (D-094) ------------------------------------------------
  const consultation = await resolveConsultationState(tx, visitId);
  if (consultation.kind === 'READY') {
    items.push({
      sourceType: 'CONSULTATION',
      sourceId: visitId,
      description: consultation.service.name,
      state: 'READY',
      stateReason: null,
      sourceStatus: null,
      supplyMode: null,
      billed: false,
      invoiceLineId: null,
      quantity: 1,
    });
  } else if (consultation.kind === 'BILLED') {
    items.push({
      sourceType: 'CONSULTATION',
      sourceId: visitId,
      description: consultation.description,
      state: 'READY',
      stateReason: null,
      sourceStatus: null,
      supplyMode: null,
      billed: true,
      invoiceLineId: consultation.invoiceLineId,
      quantity: 1,
    });
  } else if (consultation.kind === 'WAIVED') {
    items.push({
      sourceType: 'CONSULTATION',
      sourceId: visitId,
      description: consultation.description,
      state: 'WAIVED',
      stateReason: 'Consultation charge was waived. It stays in the invoice history.',
      sourceStatus: null,
      supplyMode: null,
      billed: false,
      invoiceLineId: consultation.invoiceLineId,
      quantity: 1,
    });
  } else if (consultation.kind === 'TARIFF_REVIEW') {
    items.push({
      sourceType: 'CONSULTATION',
      sourceId: visitId,
      description: 'Consultation',
      state: 'TARIFF_REVIEW',
      stateReason: consultation.reason,
      sourceStatus: null,
      supplyMode: null,
      billed: false,
      invoiceLineId: null,
      quantity: 1,
    });
  } else if (consultation.kind === 'EXEMPT') {
    items.push({
      sourceType: 'CONSULTATION',
      sourceId: visitId,
      description: 'Consultation',
      state: 'NOT_CHARGEABLE',
      stateReason: 'This kind of visit carries no consultation charge.',
      sourceStatus: null,
      supplyMode: null,
      billed: false,
      invoiceLineId: null,
      quantity: 1,
    });
  }
  // NOT_CONFIGURED and NOT_APPLICABLE add no row: nothing to review.

  return items;
}

/** The completion rule: chargeable-and-ready items that no active line bills. */
export function unbilledReadyItems(worklist: BillingWorklistItem[]): BillingWorklistItem[] {
  return worklist.filter((item) => item.state === 'READY' && !item.billed);
}

/**
 * The doctor-phase routing rule: billing work that still lies AHEAD of the
 * patient — ready-but-unbilled charges AND ordered clinic medication that
 * has not been dispensed yet. Wider than unbilledReadyItems on purpose: an
 * ORDERED onsite medication is not finalisable yet, but the patient plainly
 * still has dispensary/billing ahead of them.
 */
export function pendingBillingWork(worklist: BillingWorklistItem[]): BillingWorklistItem[] {
  return worklist.filter(
    (item) => !item.billed && (item.state === 'READY' || item.state === 'AWAITING_DISPENSE'),
  );
}

/** The consultation blocker: tariff configured but unresolvable — a human must look. */
export function tariffReviewItems(worklist: BillingWorklistItem[]): BillingWorklistItem[] {
  return worklist.filter((item) => item.state === 'TARIFF_REVIEW');
}
