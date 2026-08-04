import { InvoiceStatus, OrderServiceStatus, PrescriptionStatus, PrescriptionSupplyMode } from '@prisma/client';
import { ClinicalTx } from './clinical-actor';

/**
 * G4.5d3c-3b1 (D-093) — the source-aware billing worklist.
 *
 * The audit found two holes in unbilled detection: it stopped looking the
 * moment ANY invoice existed, and it counted every prescription as clinic
 * work regardless of supply mode. This is the replacement — an itemised list
 * of every chargeable source record with its billing state, correct whether
 * or not invoices already exist.
 *
 * CHARGEABILITY (owner decision 4):
 *   Prescriptions — only a valid ONSITE_DISPENSE row (ORDERED or DISPENSED)
 *   is a clinic medication charge. EXTERNAL_PRESCRIPTION, PATIENT_OWN_SUPPLY
 *   and NO_SUPPLY_REQUIRED are never clinic charges. DEFERRED and NULL are
 *   UNRESOLVED — listed so a screen can say why, but not chargeable until a
 *   doctor picks a final mode (their own completion blockers already stand).
 *   CANCELLED and soft-deleted rows do not exist here.
 *
 *   Orders — a TASK_ORDER is chargeable at COMPLETED (never before the work
 *   happened, never after cancellation); a STANDARD_SERVICE is chargeable
 *   unless CANCELLED (D-073's rule, unchanged).
 *
 * BILLED means an ACTIVE line (not cancelled) on a non-CANCELLED invoice
 * references the source — on ANY invoice of the visit, so a second invoice
 * cannot hide a first invoice's gap, and a cancelled line honestly reopens
 * the item.
 *
 * Consultation fee has no source record yet and therefore cannot appear —
 * that is 3b2's auto-propose work, stated rather than papered over.
 */
export type BillingWorklistSourceType = 'PRESCRIPTION' | 'ORDER_SERVICE';

export interface BillingWorklistItem {
  sourceType: BillingWorklistSourceType;
  sourceId: string;
  description: string;
  /** READY = chargeable now; UNRESOLVED_SUPPLY = a doctor decision pending. */
  state: 'READY' | 'UNRESOLVED_SUPPLY';
  billed: boolean;
  /** The invoice line that bills it, where one exists. */
  invoiceLineId: string | null;
  quantity: number | null;
}

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
    if (
      mode === PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION ||
      mode === PrescriptionSupplyMode.PATIENT_OWN_SUPPLY ||
      mode === PrescriptionSupplyMode.NO_SUPPLY_REQUIRED
    ) {
      continue; // never a clinic medication charge
    }
    const unresolved = mode === null || mode === PrescriptionSupplyMode.DEFERRED;
    const lineId = lineByPrescription.get(prescription.id) ?? null;
    items.push({
      sourceType: 'PRESCRIPTION',
      sourceId: prescription.id,
      description: prescription.item?.name ?? 'Medication',
      state: unresolved ? 'UNRESOLVED_SUPPLY' : 'READY',
      billed: lineId !== null,
      invoiceLineId: lineId,
      quantity: prescription.quantity,
    });
  }

  for (const order of orders) {
    if (order.status === OrderServiceStatus.CANCELLED) continue;
    const chargeable =
      order.orderType === 'STANDARD_SERVICE' ? true : order.status === OrderServiceStatus.COMPLETED;
    if (!chargeable) continue; // a pending procedure is the procedure blocker's business, not billing's
    const lineId = lineByOrder.get(order.id) ?? null;
    items.push({
      sourceType: 'ORDER_SERVICE',
      sourceId: order.id,
      description: order.procedureName,
      state: 'READY',
      billed: lineId !== null,
      invoiceLineId: lineId,
      quantity: 1,
    });
  }

  return items;
}

/** The completion rule: chargeable-and-ready items that no active line bills. */
export function unbilledReadyItems(worklist: BillingWorklistItem[]): BillingWorklistItem[] {
  return worklist.filter((item) => item.state === 'READY' && !item.billed);
}
