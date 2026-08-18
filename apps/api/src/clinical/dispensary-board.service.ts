import { Inject, Injectable } from '@nestjs/common';
import { PrescriptionStatus, PrescriptionSupplyMode, QueueTicketStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requireActor, withReadOnlyTenantTx } from './clinical-actor';
import { assertCanPerformDispensary, dispensaryPermissionsFor } from './dispensary-authorization';
import { StockState, stockStateFor } from './dispensary.service';
import { dispenseCalculation } from './dispense-pricing';

/**
 * G4.5d5b-2 — ONE read behind the whole dispensary workspace.
 *
 * The shape is deliberate. A patient list where each row then fetches its own
 * medications, and each medication then fetches its own stock, is a request
 * waterfall that gets worse exactly when the clinic is busiest — which is the
 * only time this screen is open. So the board answers in a fixed number of
 * queries regardless of how many patients are waiting: the tickets, then
 * their prescriptions in one `IN` query, then the stock levels for the
 * distinct items in one more.
 *
 * Three queries for fifty waiting patients, not one hundred and one.
 */

export interface DispensaryMedication {
  prescriptionId: string;
  itemId: string;
  name: string;
  strength: string | null;
  doseAmount: string;
  doseUnit: string | null;
  frequency: string;
  durationDays: number;
  quantity: number;
  status: PrescriptionStatus;
  supplyMode: PrescriptionSupplyMode | null;
  prescriberName: string | null;
  dispenserName: string | null;
  dispensedAt: Date | null;
  stock: {
    onHand: number | null;
    state: StockState;
    /** The prescription's own unit, for honest display. */
    prescriptionUnit: string | null;
  };
  labelPrintCount: number;
  lastPrintedAt: Date | null;
}

export interface DispensaryRow {
  visitId: string;
  queueTicketId: string;
  displayNumber: string | null;
  patientName: string;
  visitNumber: string;
  doctorName: string | null;
  checkInAt: Date;
  queueStatus: QueueTicketStatus;
  counts: { total: number; dispensed: number; remaining: number };
  /** Rows a dispenser can act on. */
  medications: DispensaryMedication[];
  /** Unresolved supply modes — a clinical blocker, shown separately. */
  unresolvedCount: number;
  /** True when any dispensable row is short. */
  hasStockWarning: boolean;
}

export interface DispensaryBoard {
  rows: DispensaryRow[];
  counts: { waitingPatients: number; medicationsRemaining: number; stockWarnings: number };
  permissions: ReturnType<typeof dispensaryPermissionsFor>;
}

@Injectable()
export class DispensaryBoardService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async board(clinicId: string): Promise<DispensaryBoard> {
    return withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformDispensary(actor, 'VIEW_DISPENSARY');

      // --- 1. The tickets at the dispensary stage -------------------------
      const tickets = await tx.queueTicket.findMany({
        where: { clinicId, status: QueueTicketStatus.READY_FOR_DISPENSARY },
        select: {
          id: true,
          displayNumber: true,
          visitId: true,
          status: true,
          visit: {
            select: {
              id: true,
              visitNumber: true,
              checkInAt: true,
              patient: { select: { name: true } },
              staff: { select: { fullName: true } },
            },
          },
        },
        // Longest waiting first: the person who has been there longest is the
        // one the counter should serve next.
        orderBy: { visit: { checkInAt: 'asc' } },
      });
      if (tickets.length === 0) {
        return {
          rows: [],
          counts: { waitingPatients: 0, medicationsRemaining: 0, stockWarnings: 0 },
          permissions: dispensaryPermissionsFor(actor),
        };
      }

      const visitIds = tickets.map((ticket) => ticket.visitId);

      // --- 2. Every prescription for those visits, in ONE query -----------
      const prescriptions = await tx.prescription.findMany({
        where: { visitId: { in: visitIds }, deletedAt: null },
        include: {
          item: {
            select: {
              id: true,
              name: true,
              strengthMg: true,
              // The divisor, so the board's shortage warning counts the same
              // units the deduction does.
              quantityPerStockUnit: true,
              unitsPerPack: true,
              dispensedWholeAt: true,
            },
          },
          prescribedBy: { select: { fullName: true } },
        },
      });

      // --- 3. Branch stock for the distinct items, in ONE query -----------
      const itemIds = [...new Set(prescriptions.map((p) => p.itemId))];
      const levels = await tx.stockLevel.findMany({
        where: { tenantId: currentTenantId(), clinicId, itemId: { in: itemIds } },
        select: { itemId: true, quantityOnHand: true },
      });
      const onHandByItem = new Map(levels.map((level) => [level.itemId, level.quantityOnHand]));

      // --- 4. Label print counts, in ONE query ----------------------------
      const printCounts = await tx.labelPrint.groupBy({
        by: ['prescriptionId'],
        where: { prescriptionId: { in: prescriptions.map((p) => p.id) } },
        _count: { _all: true },
        _max: { printedAt: true },
      });
      const printsByPrescription = new Map(
        printCounts.map((row) => [row.prescriptionId, { count: row._count._all, last: row._max.printedAt }]),
      );

      const dispenserIds = [
        ...new Set(prescriptions.map((p) => p.dispensedByStaffId).filter((id): id is string => Boolean(id))),
      ];
      const dispensers = dispenserIds.length
        ? await tx.staff.findMany({ where: { id: { in: dispenserIds } }, select: { id: true, fullName: true } })
        : [];
      const dispenserById = new Map(dispensers.map((staff) => [staff.id, staff.fullName]));

      const rows: DispensaryRow[] = tickets.map((ticket) => {
        const mine = prescriptions.filter((p) => p.visitId === ticket.visitId);
        // Only clinic-supplied medication is a dispensary card. External,
        // patient-own and no-supply rows are not the counter's work and are
        // excluded rather than shown as things somebody forgot to do.
        const dispensable = mine.filter(
          (p) =>
            p.supplyMode === PrescriptionSupplyMode.ONSITE_DISPENSE &&
            p.status !== PrescriptionStatus.CANCELLED,
        );
        const unresolved = mine.filter(
          (p) =>
            p.status === PrescriptionStatus.ORDERED &&
            (p.supplyMode === null || p.supplyMode === PrescriptionSupplyMode.DEFERRED),
        );

        const medications: DispensaryMedication[] = dispensable.map((p) => {
          const onHand = onHandByItem.get(p.itemId) ?? null;
          const dispense = dispenseCalculation(p.quantity, p.item);
          const prints = printsByPrescription.get(p.id);
          return {
            prescriptionId: p.id,
            itemId: p.itemId,
            name: p.item.name,
            strength: p.item.strengthMg ? `${p.item.strengthMg}mg` : null,
            doseAmount: String(p.amount),
            doseUnit: p.unit ?? null,
            frequency: p.frequency,
            durationDays: p.durationDays,
            quantity: p.quantity,
            status: p.status,
            supplyMode: p.supplyMode,
            prescriberName: p.prescribedBy?.fullName ?? null,
            dispenserName: p.dispensedByStaffId ? (dispenserById.get(p.dispensedByStaffId) ?? null) : null,
            dispensedAt: p.dispensedAt,
            stock: {
              onHand,
              state: stockStateFor({
                onHand,
                // STOCK UNITS on both sides. This used to compare a shelf
                // counted in strips against a course counted in tablets and
                // call a full drawer INSUFFICIENT; the conversion is the one
                // the deduction and the bill both use.
                required: dispense.dispenseQuantity ?? 0,
                // The conversion model exists now, so "cannot be compared" is
                // reserved for the case where it genuinely cannot: an item
                // whose pack size nobody has stated. Inventing a divisor of 1
                // is what this replaced.
                comparable: onHand !== null && dispense.dispenseQuantity !== null,
              }),
              prescriptionUnit: p.unit ?? null,
            },
            labelPrintCount: prints?.count ?? 0,
            lastPrintedAt: prints?.last ?? null,
          };
        });

        const dispensed = medications.filter((m) => m.status === PrescriptionStatus.DISPENSED).length;
        const remaining = medications.filter((m) => m.status === PrescriptionStatus.ORDERED).length;

        return {
          visitId: ticket.visitId,
          queueTicketId: ticket.id,
          displayNumber: ticket.displayNumber,
          patientName: ticket.visit.patient.name,
          visitNumber: ticket.visit.visitNumber,
          doctorName: ticket.visit.staff?.fullName ?? null,
          checkInAt: ticket.visit.checkInAt,
          queueStatus: ticket.status,
          counts: { total: medications.length, dispensed, remaining },
          medications,
          unresolvedCount: unresolved.length,
          hasStockWarning: medications.some(
            (m) =>
              m.status === PrescriptionStatus.ORDERED &&
              (m.stock.state === 'INSUFFICIENT' || m.stock.state === 'OUT_OF_STOCK'),
          ),
        };
      });

      return {
        rows,
        counts: {
          waitingPatients: rows.length,
          medicationsRemaining: rows.reduce((total, row) => total + row.counts.remaining, 0),
          stockWarnings: rows.filter((row) => row.hasStockWarning).length,
        },
        permissions: dispensaryPermissionsFor(actor),
      };
    });
  }
}
