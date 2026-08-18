import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PrescriptionStatus,
  PrescriptionSupplyMode,
  QueueTicketStatus,
  StockMovementType,
  VisitWorkflowEventType,
} from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import {
  ClinicalTx,
  assertMayTouchVisit,
  requireActor,
  withReadOnlyTenantTx,
  withTenantTx,
} from './clinical-actor';
import { dispenseCalculation } from './dispense-pricing';
import { assertCanPerformDispensary } from './dispensary-authorization';
import { isLegalQueueTransition } from './queue-authorization';

/**
 * G4.5d5b-2 — the dispensary's server side.
 *
 * `PrescriptionService.dispense` had an atomic claim and a supply-mode check
 * (D-093) and two holes the audit named: no ROLE gate and no BRANCH gate. It
 * called `requireActor` and stopped, so any authenticated staff member of any
 * role, at any branch of the tenant, could move clinic stock. Both are closed
 * here, and this service is where every dispensary operation now goes.
 */

/** Why a prescription is or is not dispensable, in the clinic's words. */
export type DispenseOutcome =
  | 'DISPENSED'
  | 'ALREADY_DISPENSED'
  | 'NO_LONGER_ELIGIBLE'
  | 'PERMISSION_DENIED'
  | 'STOCK_WARNING_ACKNOWLEDGED'
  | 'FAILED';

export interface DispenseItemResult {
  prescriptionId: string;
  outcome: DispenseOutcome;
  /** Staff-facing. Never an enum, a column or a driver string. */
  message: string;
  medicationName: string | null;
}

export interface DispenseResult {
  visitId: string;
  results: DispenseItemResult[];
  summary: { dispensed: number; alreadyDispensed: number; failed: number };
  /** What the visit's queue state became, if anything moved it. */
  routing: RoutingOutcome;
}

export interface RoutingOutcome {
  /** True when this call completed the visit's clinic dispensing. */
  dispensingComplete: boolean;
  queueStatus: QueueTicketStatus | null;
  /** Staff-facing sentence about where the patient goes now. */
  message: string;
}

/** How stock compares to what the prescription asks for. */
export type StockState = 'IN_STOCK' | 'LOW_STOCK' | 'INSUFFICIENT' | 'OUT_OF_STOCK' | 'UNIT_UNKNOWN';

@Injectable()
export class DispensaryService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * Dispense one or more prescriptions belonging to ONE visit.
   *
   * Single and multi are the same code path, because a "multi" that took a
   * different route would be a second implementation of the eligibility rules
   * — and the second one is always the one that drifts.
   *
   * Each prescription is claimed in its OWN transaction. That is the
   * important design decision here: one broad transaction around the batch
   * would be simpler and would weaken every per-prescription guarantee at
   * once — a later failure would roll back medicine that has already been
   * handed to the patient, and the atomic claim would no longer be per-row.
   * So a failure leaves the successes standing, and the caller is told
   * per item.
   */
  async dispense(params: {
    visitId: string;
    prescriptionIds: string[];
    /** Set when the user has explicitly accepted an insufficient-stock warning. */
    acknowledgeStockWarning?: boolean;
  }): Promise<DispenseResult> {
    const { visitId, prescriptionIds } = params;
    if (prescriptionIds.length === 0) {
      throw new BadRequestException('Choose at least one medication to dispense.');
    }

    // Authorisation and cross-visit checks happen ONCE, before anything is
    // claimed. A batch that is partly someone else's visit is refused whole:
    // there is no version of "dispense some of it" that is safe here.
    await withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformDispensary(actor, 'DISPENSE_MEDICATION');
      // Tenant AND branch. This is the gap the audit found.
      await assertMayTouchVisit(tx, visitId, actor);

      const foreign = await tx.prescription.count({
        where: { id: { in: prescriptionIds }, visitId: { not: visitId } },
      });
      if (foreign > 0) {
        throw new BadRequestException('All selected medications must belong to the same patient visit.');
      }
    });

    const results: DispenseItemResult[] = [];
    for (const prescriptionId of prescriptionIds) {
      results.push(
        await this.dispenseOne(visitId, prescriptionId, params.acknowledgeStockWarning ?? false),
      );
    }

    // Routing is re-evaluated once, after the batch, from stored data.
    const routing = await this.reevaluateRouting(visitId);

    return {
      visitId,
      results,
      summary: {
        dispensed: results.filter((r) => r.outcome === 'DISPENSED' || r.outcome === 'STOCK_WARNING_ACKNOWLEDGED').length,
        alreadyDispensed: results.filter((r) => r.outcome === 'ALREADY_DISPENSED').length,
        failed: results.filter((r) => r.outcome === 'FAILED' || r.outcome === 'NO_LONGER_ELIGIBLE').length,
      },
      routing,
    };
  }

  /**
   * One prescription, one transaction, one atomic claim.
   *
   * The claim is the D-087 pattern: the preconditions live in the WHERE
   * clause, so exactly one concurrent request can ever see count 1 and only
   * that request moves stock. Nothing about the quantity comes from the
   * caller — it is read from the prescription the doctor wrote.
   */
  private async dispenseOne(
    visitId: string,
    prescriptionId: string,
    acknowledgeStockWarning: boolean,
  ): Promise<DispenseItemResult> {
    try {
      return await withTenantTx(this.rawPrisma, async (tx) => {
        const actor = await requireActor(tx);
        assertCanPerformDispensary(actor, 'DISPENSE_MEDICATION');

        const prescription = await tx.prescription.findUnique({
          where: { id: prescriptionId },
          include: {
            item: {
              select: {
                name: true,
                // The divisor travels with the medicine: without it there is
                // no number of packs to hand over. See the conversion below.
                quantityPerStockUnit: true,
                unitsPerPack: true,
                dispensedWholeAt: true,
              },
            },
          },
        });
        const name = prescription?.item?.name ?? null;

        if (!prescription || prescription.deletedAt || prescription.visitId !== visitId) {
          return {
            prescriptionId,
            outcome: 'NO_LONGER_ELIGIBLE' as const,
            message: 'This medication is no longer part of the visit.',
            medicationName: name,
          };
        }

        const visit = await tx.visit.findUnique({
          where: { id: visitId },
          select: { clinicId: true },
        });
        if (!visit) throw new NotFoundException('Visit not found');

        // WHAT LEAVES THE SHELF IS NOT WHAT THE DOCTOR WROTE.
        //
        // 30 tablets of a 10-per-strip medicine is three strips off the shelf.
        // This path used to deduct thirty, and to warn about a shortage of
        // thirty — so a counter with four strips was told it was short, and a
        // counter that dispensed anyway went ninety units negative. Both
        // numbers come from the one conversion the bill also uses.
        const dispense = dispenseCalculation(prescription.quantity, prescription.item);
        if (dispense.dispenseQuantity === null) {
          // A soft refusal, like the shortage warning: this medicine does not
          // go out, the rest of the batch is unaffected, and the message names
          // the fix. Never a fallback of 1 — that guess is what this replaced.
          return {
            prescriptionId,
            outcome: 'FAILED' as const,
            message: dispense.reason ?? 'This medication cannot be dispensed yet.',
            medicationName: name,
          };
        }

        // Stock is read BEFORE the claim so the warning describes the state
        // the user was shown, and the acknowledgement is recorded against it.
        const level = await tx.stockLevel.findUnique({
          where: {
            tenantId_clinicId_itemId: {
              tenantId: currentTenantId(),
              clinicId: visit.clinicId,
              itemId: prescription.itemId,
            },
          },
          select: { quantityOnHand: true },
        });
        const onHand = level?.quantityOnHand ?? 0;
        // Compared in STOCK UNITS, because that is what `quantityOnHand`
        // counts. "Insufficient" now means what the shelf means by it.
        const insufficient = onHand < dispense.dispenseQuantity;

        if (insufficient && !acknowledgeStockWarning) {
          // Not a hard block — the approved policy allows dispensing under an
          // acknowledged warning — but it is never silent. Negative stock is
          // created deliberately or not at all.
          return {
            prescriptionId,
            outcome: 'FAILED' as const,
            // Both figures, so the message does not read as arithmetic the
            // staff member cannot follow: 3 required for a course of 30.
            message: `Only ${onHand} in stock at this branch and ${dispense.dispenseQuantity} is required for ${dispense.clinicalQuantity} (${dispense.divisor} per unit). Acknowledge the shortage to dispense anyway.`,
            medicationName: name,
          };
        }

        const dispensedAt = new Date();
        const claim = await tx.prescription.updateMany({
          where: {
            id: prescriptionId,
            status: PrescriptionStatus.ORDERED,
            supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE,
            deletedAt: null,
          },
          data: {
            status: PrescriptionStatus.DISPENSED,
            dispensedAt,
            dispensedByStaffId: actor.id,
          },
        });

        if (claim.count === 0) {
          if (prescription.status === PrescriptionStatus.DISPENSED) {
            return {
              prescriptionId,
              outcome: 'ALREADY_DISPENSED' as const,
              message: 'Already dispensed by another staff member.',
              medicationName: name,
            };
          }
          return {
            prescriptionId,
            outcome: 'NO_LONGER_ELIGIBLE' as const,
            message: eligibilityReason(prescription.status, prescription.supplyMode),
            medicationName: name,
          };
        }

        const tenantId = currentTenantId();
        await tx.stockMovement.create({
          data: {
            tenantId,
            clinicId: visit.clinicId,
            itemId: prescription.itemId,
            movementType: StockMovementType.DISPENSED,
            // The SERVER's quantity, from the prescription the doctor wrote,
            // converted to the stock units the shelf is counted in. No
            // caller-supplied number reaches this line, which is what makes
            // partial dispensing impossible rather than merely unimplemented.
            quantityDelta: -dispense.dispenseQuantity,
            // The dose units beside them, so "why did three strips leave" is
            // answerable from the row.
            clinicalQuantity: dispense.clinicalQuantity,
            referenceType: 'Prescription',
            referenceId: prescription.id,
            createdByUserId: actor.userId,
            ...(insufficient
              ? { notes: `Dispensed with an acknowledged stock shortage (${onHand} on hand).` }
              : {}),
          },
        });
        await tx.stockLevel.upsert({
          where: {
            tenantId_clinicId_itemId: { tenantId, clinicId: visit.clinicId, itemId: prescription.itemId },
          },
          create: {
            tenantId,
            clinicId: visit.clinicId,
            itemId: prescription.itemId,
            quantityOnHand: -dispense.dispenseQuantity,
          },
          update: { quantityOnHand: { decrement: dispense.dispenseQuantity } },
        });

        return {
          prescriptionId,
          outcome: insufficient ? ('STOCK_WARNING_ACKNOWLEDGED' as const) : ('DISPENSED' as const),
          message: insufficient
            ? 'Dispensed with an acknowledged stock shortage.'
            : 'Dispensed.',
          medicationName: name,
        };
      });
    } catch (error) {
      // A refusal for ONE medication must not abandon the rest of the batch.
      // Permission and tenancy failures are re-thrown by the pre-check above,
      // so anything landing here is specific to this prescription.
      return {
        prescriptionId,
        outcome: 'FAILED' as const,
        message: error instanceof BadRequestException ? error.message : 'This medication could not be dispensed.',
        medicationName: null,
      };
    }
  }

  /**
   * After dispensing, decide whether the visit has finished at the counter.
   *
   * Deliberately narrow. It records the completion event and moves the ticket
   * to payment, and it changes NOTHING financial: no invoice total, no patient
   * responsibility, no panel responsibility, no receivable state. It never
   * completes the visit — that is a counter decision under its own blockers.
   *
   * Documentation Pending (D-096) is not consulted at all: an unsigned note
   * does not hold a patient at the dispensary any more than it held them in
   * the consultation room. It still blocks final visit completion.
   */
  private async reevaluateRouting(visitId: string): Promise<RoutingOutcome> {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const outstanding = await tx.prescription.count({
        where: {
          visitId,
          deletedAt: null,
          supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE,
          status: PrescriptionStatus.ORDERED,
        },
      });
      const ticket = await tx.queueTicket.findUnique({
        where: { visitId },
        select: { id: true, status: true, clinicId: true },
      });

      if (outstanding > 0) {
        return {
          dispensingComplete: false,
          queueStatus: ticket?.status ?? null,
          message: `${outstanding} medication${outstanding === 1 ? '' : 's'} still to dispense.`,
        };
      }
      if (!ticket) {
        return { dispensingComplete: true, queueStatus: null, message: 'All clinic medication has been dispensed.' };
      }

      // The transition is checked against the legal table, not assumed. A
      // ticket already past this stage is left exactly where it is.
      if (!isLegalQueueTransition(ticket.status, QueueTicketStatus.READY_FOR_PAYMENT)) {
        return {
          dispensingComplete: true,
          queueStatus: ticket.status,
          message: 'All clinic medication has been dispensed.',
        };
      }

      // Atomic: two staff finishing the last two medications at the same
      // moment must produce ONE transition and ONE event.
      const moved = await tx.queueTicket.updateMany({
        where: { id: ticket.id, status: QueueTicketStatus.READY_FOR_DISPENSARY },
        data: { status: QueueTicketStatus.READY_FOR_PAYMENT },
      });
      if (moved.count === 0) {
        const fresh = await tx.queueTicket.findUnique({ where: { visitId }, select: { status: true } });
        return {
          dispensingComplete: true,
          queueStatus: fresh?.status ?? ticket.status,
          message: 'All clinic medication has been dispensed.',
        };
      }

      const actor = await requireActor(tx);
      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: ticket.clinicId,
          visitId,
          queueTicketId: ticket.id,
          eventType: VisitWorkflowEventType.DISPENSING_COMPLETED,
          previousStatus: QueueTicketStatus.READY_FOR_DISPENSARY,
          newStatus: QueueTicketStatus.READY_FOR_PAYMENT,
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
        },
      });

      return {
        dispensingComplete: true,
        queueStatus: QueueTicketStatus.READY_FOR_PAYMENT,
        message: 'All clinic medication dispensed. The patient moves to Payment.',
      };
    });
  }
}

/** Why this prescription cannot be dispensed, without naming an enum. */
function eligibilityReason(status: PrescriptionStatus, supplyMode: PrescriptionSupplyMode | null): string {
  if (status === PrescriptionStatus.CANCELLED) return 'This prescription was cancelled.';
  if (supplyMode === null) return 'The supply mode has not been confirmed by the prescriber.';
  if (supplyMode === PrescriptionSupplyMode.DEFERRED) return 'The supply mode is deferred and unresolved.';
  if (supplyMode === PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION) {
    return 'This is an external prescription — the clinic does not supply it.';
  }
  if (supplyMode === PrescriptionSupplyMode.PATIENT_OWN_SUPPLY) {
    return 'The patient already has this medication.';
  }
  if (supplyMode === PrescriptionSupplyMode.NO_SUPPLY_REQUIRED) return 'No supply is required.';
  return 'This medication is no longer eligible for dispensing.';
}

/**
 * How the branch's stock compares with what the prescription asks for.
 *
 * `Prescription.quantity` is a STOCK-UNIT quantity, and this comparison is
 * only made where that holds. There is no unit-conversion model in the
 * product: dose × frequency × duration cannot be turned into bottles or
 * millilitres without one, and pretending otherwise would put a confident
 * wrong number in front of a dispenser. Where the units cannot be compared
 * the honest answer is UNIT_UNKNOWN, and the UI says so in words.
 */
export function stockStateFor(params: {
  onHand: number | null;
  required: number;
  reorderLevel?: number | null;
  comparable: boolean;
}): StockState {
  if (!params.comparable || params.onHand === null) return 'UNIT_UNKNOWN';
  if (params.onHand <= 0) return 'OUT_OF_STOCK';
  if (params.onHand < params.required) return 'INSUFFICIENT';
  if (params.reorderLevel != null && params.onHand <= params.reorderLevel) return 'LOW_STOCK';
  return 'IN_STOCK';
}
