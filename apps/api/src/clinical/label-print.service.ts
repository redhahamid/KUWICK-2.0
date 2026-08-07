import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrescriptionStatus, PrescriptionSupplyMode, Staff } from '@prisma/client';
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
import { assertCanPerformDispensary } from './dispensary-authorization';

/**
 * G4.5d5b-2 — medication labels, assembled by the SERVER.
 *
 * `printTextDocument.printDrugLabel` built the label in the browser from
 * whatever the page was holding, and left no record. Two things follow from
 * that, and both are why this service exists:
 *
 *   THE CONTENT WAS CLIENT-SUPPLIED. A medication name and a set of
 *   directions that reach the printer from browser state are a medication
 *   name and directions nobody has verified against the prescription. Every
 *   field below is read from the Prescription, the Visit, the Patient and the
 *   Clinic inside a tenant-scoped transaction. Nothing on the label comes
 *   from the request except which prescription and how many copies.
 *
 *   NOTHING WAS AUDITED. A clinic could not answer "was this label printed,
 *   and by whom" — which matters most in exactly the case where it is asked.
 *
 * PRINTING IS NOT DISPENSING. This service moves no stock, changes no
 * prescription status, touches no queue ticket and touches no invoice. The
 * only row it writes is the audit row.
 */

export const MAX_LABEL_COPIES = 3;
export const DEFAULT_LABEL_FORMAT = 'KUWICK_STD_70x40';

export interface LabelPayload {
  prescriptionId: string;
  clinic: { name: string; branch: string | null };
  patient: { name: string; identifier: string | null };
  medication: {
    name: string;
    /** Only where the item genuinely stores it. Never inferred. */
    strength: string | null;
    doseAmount: string;
    doseUnit: string | null;
    frequency: string;
    durationDays: number;
    quantity: number;
    indication: string | null;
    remark: string | null;
  };
  prescriber: string;
  /** Who ran this print. */
  processedBy: string;
  /** Present only when the medication has already been handed over. */
  dispensedBy: string | null;
  visitReference: string;
  printedAt: string;
  copies: number;
  labelFormat: string;
  /** 1 for the first print of this prescription. */
  printSequence: number;
  isReprint: boolean;
}

export interface LabelHistoryEntry {
  id: string;
  printedByName: string;
  printedAt: Date;
  copies: number;
  printSequence: number;
  isReprint: boolean;
}

@Injectable()
export class LabelPrintService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * G4.5d5b-3 — assemble a label WITHOUT recording a print.
   *
   * The workspace shows the dispenser the label before it goes to the
   * printer, and that preview has to come from the record rather than from
   * anything the browser is holding — so it needs the same assembly. What it
   * must NOT do is write an audit row: a label somebody looked at and closed
   * was not printed, and a print history that counts previews cannot answer
   * the one question it exists to answer.
   *
   * Read-only, and authorised exactly as printing is. `printSequence` and
   * `isReprint` are what the NEXT print would be, so the preview can say
   * "Reprint #2" truthfully; the real values are allocated inside the print
   * transaction, against the unique constraint, and are not taken from here.
   */
  async preview(prescriptionId: string, copies = 1): Promise<LabelPayload> {
    assertCopies(copies);
    return withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformDispensary(actor, 'PRINT_LABEL');
      const { prescription, dispenser } = await loadLabelSource(tx, prescriptionId, actor);
      const previous = await tx.labelPrint.count({ where: { prescriptionId } });
      return composeLabelPayload({
        prescription,
        dispenser,
        actorName: actor.fullName,
        copies,
        printedAt: new Date(),
        printSequence: previous + 1,
        isReprint: previous > 0,
        labelFormat: DEFAULT_LABEL_FORMAT,
      });
    });
  }

  /**
   * Authorise, validate, assemble, audit, return.
   *
   * The audit row and the payload are produced in ONE transaction, so a
   * label cannot be handed to a printer without the record of it existing —
   * and the print sequence is allocated inside that transaction, against a
   * unique constraint, so two simultaneous prints cannot both be "the first".
   */
  async print(prescriptionId: string, copies = 1): Promise<LabelPayload> {
    assertCopies(copies);

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformDispensary(actor, 'PRINT_LABEL');

      const { prescription, dispenser } = await loadLabelSource(tx, prescriptionId, actor);

      // Sequence allocated here, inside the transaction, protected by the
      // unique index on (prescription_id, print_sequence).
      const previous = await tx.labelPrint.count({ where: { prescriptionId } });
      const printSequence = previous + 1;
      const isReprint = previous > 0;

      const audit = await tx.labelPrint.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: prescription.visit.clinicId,
          prescriptionId,
          printedByStaffId: actor.id,
          printerNameSnapshot: actor.fullName,
          copies,
          printSequence,
          isReprint,
          labelFormat: DEFAULT_LABEL_FORMAT,
        },
      });

      return composeLabelPayload({
        prescription,
        dispenser,
        actorName: actor.fullName,
        copies,
        // The audit row's own timestamp, so the label and the record agree
        // about when this print happened.
        printedAt: audit.printedAt,
        printSequence,
        isReprint,
        labelFormat: audit.labelFormat,
      });
    });
  }

  /** Who printed this label, when, and how many times. */
  async history(prescriptionId: string): Promise<LabelHistoryEntry[]> {
    return withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformDispensary(actor, 'VIEW_DISPENSARY');
      const prescription = await tx.prescription.findUnique({
        where: { id: prescriptionId },
        select: { visitId: true },
      });
      if (!prescription) throw new NotFoundException('Prescription not found');
      await assertMayTouchVisit(tx, prescription.visitId, actor);

      const rows = await tx.labelPrint.findMany({
        where: { prescriptionId },
        orderBy: { printedAt: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        printedByName: row.printerNameSnapshot,
        printedAt: row.printedAt,
        copies: row.copies,
        printSequence: row.printSequence,
        isReprint: row.isReprint,
      }));
    });
  }
}

function assertCopies(copies: number): void {
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_LABEL_COPIES) {
    throw new BadRequestException(`Choose between 1 and ${MAX_LABEL_COPIES} copies.`);
  }
}

/**
 * Read the prescription a label is made from, and refuse early.
 *
 * Shared by `preview` and `print` so the two can never diverge on WHAT gets a
 * label. A preview that shows a label the print route would refuse — or worse,
 * one assembled from a slightly different read — is a preview that stops being
 * evidence of anything.
 */
async function loadLabelSource(tx: ClinicalTx, prescriptionId: string, actor: Staff) {
  const prescription = await tx.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      item: true,
      prescribedBy: { select: { fullName: true } },
      visit: {
        select: {
          id: true,
          clinicId: true,
          visitNumber: true,
          patient: { select: { name: true, identifierValue: true } },
          clinic: { select: { name: true } },
        },
      },
    },
  });
  if (!prescription || prescription.deletedAt) {
    throw new NotFoundException('Prescription not found');
  }
  // Tenant AND branch, through the same helper every clinical write uses.
  await assertMayTouchVisit(tx, prescription.visitId, actor);
  assertLabelEligible(prescription.status, prescription.supplyMode);

  const dispenser = prescription.dispensedByStaffId
    ? await tx.staff.findUnique({
        where: { id: prescription.dispensedByStaffId },
        select: { fullName: true },
      })
    : null;

  return { prescription, dispenser };
}

type LabelSource = Awaited<ReturnType<typeof loadLabelSource>>;

/**
 * The label's content, from the record and nothing else.
 *
 * Pure: no reads, no writes, no clock. Everything variable is a parameter, so
 * the one thing this function decides is which stored value goes on which
 * line — and a test can read the whole answer in one place.
 */
function composeLabelPayload(params: {
  prescription: LabelSource['prescription'];
  dispenser: LabelSource['dispenser'];
  actorName: string;
  copies: number;
  printedAt: Date;
  printSequence: number;
  isReprint: boolean;
  labelFormat: string;
}): LabelPayload {
  const { prescription, dispenser } = params;
  return {
    prescriptionId: prescription.id,
    clinic: {
      name: prescription.visit.clinic.name,
      // `Clinic` carries a name and no separate branch label, so the branch
      // line is omitted rather than invented. Documented as a future optional
      // field.
      branch: null,
    },
    patient: {
      name: prescription.visit.patient.name,
      identifier: prescription.visit.patient.identifierValue ?? null,
    },
    medication: {
      name: prescription.item.name,
      // Only where the item genuinely stores it. A generic name, a dosage
      // form and a route are NOT fabricated: the schema does not reliably
      // carry them, and a route printed wrongly on a medication label is a
      // patient-safety defect, not a cosmetic gap.
      strength: prescription.item.strengthMg ? `${prescription.item.strengthMg}mg` : null,
      doseAmount: String(prescription.amount),
      doseUnit: prescription.unit ?? null,
      frequency: prescription.frequency,
      durationDays: prescription.durationDays,
      quantity: prescription.quantity,
      indication: prescription.indication ?? null,
      remark: prescription.remark ?? null,
    },
    prescriber: prescription.prescribedBy.fullName,
    processedBy: params.actorName,
    dispensedBy: dispenser?.fullName ?? null,
    visitReference: prescription.visit.visitNumber,
    printedAt: params.printedAt.toISOString(),
    copies: params.copies,
    labelFormat: params.labelFormat,
    printSequence: params.printSequence,
    isReprint: params.isReprint,
  };
}

/**
 * Which prescriptions get an operational drug label.
 *
 * The old client-side path printed one for anything on screen, including
 * cancelled rows and medication the clinic is not supplying. A label is an
 * instruction attached to a physical package the clinic hands over; printing
 * one for an external prescription tells the patient the clinic dispensed
 * something it did not.
 */
export function assertLabelEligible(
  status: PrescriptionStatus,
  supplyMode: PrescriptionSupplyMode | null,
): void {
  if (status === PrescriptionStatus.CANCELLED) {
    throw new BadRequestException('This prescription was cancelled — no label can be printed for it.');
  }
  if (supplyMode === null) {
    throw new BadRequestException(
      'The supply mode has not been confirmed. The prescriber must set it before a label is printed.',
    );
  }
  if (supplyMode === PrescriptionSupplyMode.DEFERRED) {
    throw new BadRequestException('The supply mode is deferred and unresolved.');
  }
  if (supplyMode !== PrescriptionSupplyMode.ONSITE_DISPENSE) {
    throw new BadRequestException(
      'A clinic medication label applies only to medication the clinic supplies.',
    );
  }
}
