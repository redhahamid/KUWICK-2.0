import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DosageCalcMethod, PrescriptionStatus, PrescriptionSupplyMode, StockMovementType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { postMovement } from '../stock/stock-ledger';
import { assertMayTouchVisit, requireActor, requireClinicalAuthor, withTenantTx } from './clinical-actor';
import { VisitService } from './visit.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { CancelPrescriptionDto } from './dto/cancel-prescription.dto';
import { CopyPrescriptionsDto } from './dto/copy-prescriptions.dto';
import { UpdateSupplyModeDto } from './dto/update-supply-mode.dto';
import { calculateWeightBasedDose, findAgeBracket } from './dosage-calculator';
import { dispenseCalculation } from './dispense-pricing';
import { composeSnapshot, durationInDays } from './prescription-snapshot';
import { CopiedSupplyDecision, describeCopyOutcome, supplyModeForCopy } from './medication-supply-rules';

@Injectable()
export class PrescriptionService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly visits: VisitService,
    private readonly rawPrisma: PrismaService,
  ) {}

  // Snapshots dose/unit/frequency/duration/indication from Item at
  // prescribe-time (same convention as Diagnosis/OrderService).
  //
  // D-085: prescribedByStaffId is the AUTHENTICATED PRESCRIBER. It used to
  // default to the visit's attending physician, which recorded Dr A as having
  // prescribed medication Dr A may never have seen.
  //
  // The calculator exists "to prevent wrong dosage" (owner, D-028), so the
  // dose is never trusted verbatim from the client: WEIGHT_BASED is
  // recomputed server-side from calcWeightKg/calcDoseRateMgKg and the
  // item's configured concVolMl/strengthMg; AGE_BASED must match one of
  // the item's configured ItemAgeDosage brackets exactly. Only MANUAL (or
  // no calcMethod — the doctor typed the dose directly) is taken as-is.
  async create(dto: CreatePrescriptionDto) {
    // Before the visit is even read: prescribing is a clinical act, and a
    // caller who may not author one should be refused without learning
    // anything about the visit.
    const author = await requireClinicalAuthor(this.prisma, 'prescribe medication');
    const visit = await this.visits.findById(dto.visitId);
    const item = await this.prisma.item.findUnique({ where: { id: dto.itemId }, include: { ageDosages: true } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    let amount = dto.amount;
    let calcTargetDoseMg: number | undefined;

    if (dto.calcMethod === DosageCalcMethod.WEIGHT_BASED) {
      if (dto.calcWeightKg === undefined || dto.calcDoseRateMgKg === undefined) {
        throw new BadRequestException('calcWeightKg and calcDoseRateMgKg are required for WEIGHT_BASED dosing');
      }
      if (item.concVolMl === null || item.strengthMg === null) {
        throw new BadRequestException(`${item.name} has no Conc. Vol/Strength configured for weight-based dosing`);
      }
      const result = calculateWeightBasedDose({
        weightKg: dto.calcWeightKg,
        doseRateMgKg: dto.calcDoseRateMgKg,
        concVolMl: Number(item.concVolMl),
        strengthMg: Number(item.strengthMg),
      });
      amount = Math.round(result.volumeMl * 100) / 100;
      calcTargetDoseMg = Math.round(result.targetDoseMg * 100) / 100;
    } else if (dto.calcMethod === DosageCalcMethod.AGE_BASED) {
      const matchesBracket = item.ageDosages.some(
        (bracket) =>
          Number(bracket.amount) === dto.amount && bracket.unit === dto.unit && bracket.frequency === dto.frequency,
      );
      if (!matchesBracket) {
        throw new BadRequestException(`Submitted dose does not match any configured age bracket for ${item.name}`);
      }
    }

    // b1 PHASE A — resolve the catalogue choices into the text this row keeps.
    // Before the write, so a bad id is a 400 rather than a half-written record.
    const snapshot = await this.resolveSnapshot(dto);
    const durationDays =
      dto.durationValue && dto.durationUnit
        ? durationInDays(dto.durationValue, dto.durationUnit)
        : dto.durationDays;

    return this.prisma.prescription.create({
      data: {
        tenantId: currentTenantId(),
        visitId: dto.visitId,
        itemId: dto.itemId,
        quantity: dto.quantity,
        amount,
        // The snapshot wins where a catalogue entry was chosen; the free-text
        // fields remain for Flow and Copy Rx, which do not use the dropdowns.
        unit: snapshot.unit ?? dto.unit,
        frequency: snapshot.frequency ?? dto.frequency,
        durationDays,
        indication: snapshot.indication ?? dto.indication,
        remark: dto.remark,
        doseUnitBm: snapshot.doseUnitBm,
        frequencyBm: snapshot.frequencyBm,
        durationValue: dto.durationValue,
        durationUnit: dto.durationUnit,
        consumptionMethod: snapshot.consumptionMethod,
        consumptionInstructionBm: snapshot.consumptionInstructionBm,
        indicationBm: snapshot.indicationBm,
        calcMethod: dto.calcMethod,
        calcWeightKg: dto.calcMethod === DosageCalcMethod.WEIGHT_BASED ? dto.calcWeightKg : undefined,
        calcDoseRateMgKg: dto.calcMethod === DosageCalcMethod.WEIGHT_BASED ? dto.calcDoseRateMgKg : undefined,
        calcTargetDoseMg,
        // G4.5d3c-1c (D-085) — the prescriber is whoever WROTE this, resolved
        // from the session and required to be entitled to author clinical
        // work. Never the visit's attending doctor by default: that recorded
        // Dr A as having prescribed something Dr A may never have seen.
        prescribedByStaffId: author.id,
        // G4.5d3c-3a1 (D-091) — the supply intent, exactly as submitted. The
        // UI defaults visibly and submits explicitly; the server adds no
        // hidden default, so an absent value stores NULL — honest "not
        // established", never a silent dispensing instruction.
        supplyMode: dto.supplyMode,
      },
    });
  }

  /**
   * b1 PHASE A — read what the chosen catalogue rows say, and copy it.
   *
   * Each lookup is scoped to this tenant and to ACTIVE rows. Not belt and
   * braces over the foreign keys: PostgreSQL checks FKs through internal
   * triggers that row-level security does not apply to, so another clinic's id
   * would be accepted by the constraint and then read back as nothing — a
   * prescription printed with no frequency and no error anywhere. A RETIRED
   * row is refused for a plainer reason: the clinic withdrew it, and a new
   * prescription must not be written against it.
   */
  private async resolveSnapshot(dto: CreatePrescriptionDto) {
    const tenantId = currentTenantId();
    const [frequency, doseUnit, consumptionMethod, indication] = await Promise.all([
      dto.frequencyId
        ? this.prisma.prescriptionFrequency.findFirst({
            where: { id: dto.frequencyId, tenantId, active: true },
            select: { code: true, patientLabelBm: true, timesPerDay: true },
          })
        : null,
      dto.doseUnitId
        ? this.prisma.dosageUnit.findFirst({
            where: { id: dto.doseUnitId, tenantId, active: true },
            select: { systemNameEn: true, patientLabelBm: true },
          })
        : null,
      dto.consumptionMethodId
        ? this.prisma.consumptionMethodRef.findFirst({
            where: { id: dto.consumptionMethodId, tenantId, active: true },
            select: { methodBilingual: true, patientInstructionBm: true },
          })
        : null,
      dto.indicationId
        ? this.prisma.indicationPreset.findFirst({
            where: { id: dto.indicationId, tenantId, active: true },
            select: { labelEn: true, labelBm: true },
          })
        : null,
    ]);

    // Named individually, so a doctor is not sent back to hunt through four
    // dropdowns for whichever one went stale.
    const missing = [
      dto.frequencyId && !frequency ? 'Frequency' : null,
      dto.doseUnitId && !doseUnit ? 'Dose unit' : null,
      dto.consumptionMethodId && !consumptionMethod ? 'Consumption method' : null,
      dto.indicationId && !indication ? 'Indication' : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new BadRequestException(
        `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} no longer on this clinic's list. Choose again.`,
      );
    }

    return composeSnapshot({ frequency, doseUnit, consumptionMethod, indication });
  }

  /**
   * G4.5d3c-3a1 (D-091) — set or change how a medication will be supplied.
   *
   * A clinical decision, so it takes the same author gate as prescribing
   * itself: front desk, finance and stock accounts are refused here, not
   * merely denied a control. The prescription's AUTHORSHIP is untouched —
   * `prescribedByStaffId` records who prescribed and this route never
   * rewrites it; a colleague changing the supply intent acts under their own
   * authenticated identity, refused unless they too can author clinical work.
   *
   * Only while ORDERED. A DISPENSED row's supply mode is a historical fact
   * about medicine already handed over, and a CANCELLED row is terminal —
   * both refuse rather than quietly rewriting the record.
   */
  /**
   * KW2-C2 — editing a carried-over medication IS reviewing it.
   *
   * Merged into whatever `data` an edit already writes, so the flag and its
   * attribution can never drift apart from the edit that cleared them. Any
   * future field editor calls this rather than re-deriving the rule.
   */
  private clearReviewOnEdit(actor: { id: string }) {
    return { reviewFlag: false, reviewedByStaffId: actor.id, reviewedAt: new Date() };
  }

  async setSupplyMode(id: string, dto: UpdateSupplyModeDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireClinicalAuthor(tx, 'set how a medication is supplied');
      const prescription = await tx.prescription.findUnique({ where: { id } });
      if (!prescription || prescription.deletedAt) {
        // A foreign tenant's row is invisible to RLS and lands here too:
        // the same 404 as a row that never existed, disclosing nothing.
        throw new NotFoundException('Prescription not found');
      }
      await assertMayTouchVisit(tx, prescription.visitId, actor);
      if (prescription.status === PrescriptionStatus.DISPENSED) {
        throw new BadRequestException(
          'This medication has already been dispensed, so its supply mode can no longer be changed.',
        );
      }
      if (prescription.status !== PrescriptionStatus.ORDERED) {
        throw new BadRequestException('A cancelled prescription cannot be edited.');
      }
      return tx.prescription.update({
        where: { id },
        // Editing a carried-over row clears its review flag and records who
        // did it — the editor is the reviewer.
        data: { supplyMode: dto.supplyMode, ...this.clearReviewOnEdit(actor) },
        include: { item: true, prescribedBy: true },
      });
    });
  }

  findByVisitId(visitId: string) {
    return this.prisma.prescription.findMany({
      where: { visitId, deletedAt: null },
      // G2b — read-only addition: the prescriber, so the medication list can
      // say who prescribed each item instead of leaving it blank.
      include: { item: true, prescribedBy: true },
      orderBy: { prescribedAt: 'desc' },
    });
  }

  // Powers the "Copy Previous Prescription" date picker — past visits for
  // this patient that have at least one (non-deleted) prescription.
  findVisitsWithPrescriptions(patientId: string, excludeVisitId?: string) {
    return this.prisma.visit.findMany({
      where: {
        patientId,
        id: excludeVisitId ? { not: excludeVisitId } : undefined,
        prescriptions: { some: { deletedAt: null } },
      },
      orderBy: { checkInAt: 'desc' },
    });
  }

  async findById(id: string) {
    const prescription = await this.prisma.prescription.findUnique({ where: { id } });
    if (!prescription || prescription.deletedAt) {
      throw new NotFoundException('Prescription not found');
    }
    return prescription;
  }

  /**
   * G4.5d3c-3c — Copy Previous now records a supply mode.
   *
   * It previously wrote none, so every copied line arrived NULL and each one
   * became a doctor-phase blocker the doctor had to clear by hand. The rule
   * that decides what to write lives in `medication-supply-rules.ts`, which
   * documents why: carry over what the source recorded, and where the source
   * recorded nothing (or deferred) take the clinic's visible default for a
   * new prescription. The SOURCE rows are never modified.
   *
   * CANCELLED source rows are excluded. Copying a prescription somebody
   * deliberately cancelled, and reviving it as an active order, is not what
   * "copy previous" means to a clinician.
   */
  async copyFromVisit(dto: CopyPrescriptionsDto) {
    const author = await requireClinicalAuthor(this.prisma, 'prescribe medication');
    const targetVisit = await this.visits.findById(dto.targetVisitId);
    const sourcePrescriptions = await this.prisma.prescription.findMany({
      where: {
        visitId: dto.sourceVisitId,
        deletedAt: null,
        status: { not: PrescriptionStatus.CANCELLED },
        // KW2-C2 — a selection narrows the copy; its absence keeps the
        // whole-visit behaviour 1.0 has always had.
        ...(dto.prescriptionIds ? { id: { in: dto.prescriptionIds } } : {}),
      },
    });

    // An id that matched nothing is a request the caller cannot have meant:
    // a cancelled row, a deleted one, or a prescription from another visit.
    // Copying the remainder silently would hand back fewer medications than
    // were ticked, with nothing said.
    if (dto.prescriptionIds && sourcePrescriptions.length !== dto.prescriptionIds.length) {
      throw new NotFoundException(
        'Some selected medications are no longer available on that visit. Reopen the list and try again.',
      );
    }

    const tenantId = currentTenantId();
    const decisions: CopiedSupplyDecision[] = [];
    const created = await Promise.all(
      sourcePrescriptions.map((source) => {
        const decision = supplyModeForCopy(source.supplyMode);
        decisions.push(decision);
        return this.prisma.prescription.create({
          data: {
            tenantId,
            visitId: dto.targetVisitId,
            itemId: source.itemId,
            quantity: source.quantity,
            amount: source.amount,
            unit: source.unit,
            frequency: source.frequency,
            durationDays: source.durationDays,
            indication: source.indication,
            remark: source.remark,
            supplyMode: decision.supplyMode,
            // Copying a previous visit's medication is a NEW prescribing
            // decision, so it is authored by whoever made it — not inherited
            // from the source prescription and not from the target visit.
            prescribedByStaffId: author.id,
            // KW2-C2 — where it came from, and that it has not been re-read
            // against today's weight, allergies and stock.
            sourceVisitId: dto.sourceVisitId,
            reviewFlag: true,
          },
        });
      }),
    );

    // The summary travels WITH the rows rather than being inferred from them:
    // "carried over from the previous visit" and "defaulted because the
    // previous visit recorded nothing" both produce a row reading "Dispense
    // from clinic", and only the server knows which happened.
    return { prescriptions: created, supplySummary: describeCopyOutcome(decisions) };
  }

  /**
   * KW2-C2 — "I have re-read this."
   *
   * Clears the carried-over flag on one prescription. Deliberately a separate,
   * explicit act rather than something inferred: a doctor scrolling past a
   * copied row has not reviewed it, and treating a render as an
   * acknowledgement would make the completion warning meaningless within a
   * day of shipping.
   *
   * ATOMIC, and idempotent. The precondition lives in the WHERE clause (the
   * D-087 pattern), so a double-click cannot produce two writes, and clearing
   * an already-clear flag is a no-op rather than an error — the caller's
   * intent is satisfied either way.
   */
  async markReviewed(id: string) {
    // The actor comes from the SESSION. A client-supplied reviewer id would
    // let the browser sign a clinical acknowledgement in someone else's name,
    // which is the same class of failure C0/D-051 closed for note signatures.
    const actor = await requireClinicalAuthor(this.prisma, 'review medication');
    const claimed = await this.prisma.prescription.updateMany({
      where: { id, deletedAt: null, reviewFlag: true },
      data: { reviewFlag: false, reviewedByStaffId: actor.id, reviewedAt: new Date() },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.prescription.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Prescription not found');
    }
    return this.prisma.prescription.findFirst({ where: { id }, include: { item: true } });
  }

  /**
   * ORDERED -> DISPENSED. Only now does stock move (D-028): a StockMovement
   * ledger row plus the cached StockLevel decrement.
   *
   * G4.5d3c-3b1 (D-093) — hardened three ways:
   *
   * ATOMIC CLAIM. The old shape read the status and then wrote — under READ
   * COMMITTED two concurrent calls could both read ORDERED and both insert a
   * movement, deducting stock twice for one hand-over. The precondition now
   * lives in the WHERE clause (the D-087 pattern): exactly one request can
   * ever see count 1, and only that request moves stock.
   *
   * SUPPLY MODE AT THE SERVER. Only ONSITE_DISPENSE may dispense. The UI has
   * gated this since D-091; now the API refuses too, so a direct caller
   * cannot move clinic stock for medicine the clinic is not supplying.
   *
   * THE DISPENSER IS RECORDED — on the prescription and on the movement.
   * Who handed the medication over is a fact the Dispensary Workspace will
   * need and an audit already wants.
   */
  async dispense(id: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const prescription = await tx.prescription.findUnique({
        where: { id },
        // The divisor comes with the prescription because the deduction cannot
        // be worked out without it — see the conversion below.
        include: {
          item: {
            select: { quantityPerStockUnit: true, unitsPerPack: true, dispensedWholeAt: true },
          },
        },
      });
      if (!prescription || prescription.deletedAt) {
        throw new NotFoundException('Prescription not found');
      }
      const visit = await tx.visit.findUnique({
        where: { id: prescription.visitId },
        select: { clinicId: true },
      });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }

      // WHAT LEAVES THE SHELF IS NOT WHAT THE DOCTOR WROTE.
      //
      // `prescription.quantity` is 30 tablets. Stock is counted in strips, so
      // 30 tablets of a 10-per-strip medicine is three strips leaving — and
      // this line used to decrement thirty. The conversion is the same one the
      // bill goes through, deliberately: a clinic whose ledger and whose
      // invoice disagree about what a unit is has two wrong numbers, not one.
      //
      // Computed BEFORE the claim, so a refusal leaves the prescription
      // ORDERED rather than marked dispensed with no stock moved.
      const dispense = dispenseCalculation(prescription.quantity, prescription.item);
      if (dispense.dispenseQuantity === null) {
        // No divisor means no answer, and 1 is not a safe guess — it is the
        // guess that produced this defect. Refusing is recoverable in the
        // minute it takes to state the pack size; deducting a number nobody
        // computed is recoverable only by counting the shelf.
        throw new BadRequestException(dispense.reason ?? 'This medication cannot be dispensed yet.');
      }

      const dispensedAt = new Date();
      const claim = await tx.prescription.updateMany({
        where: {
          id,
          status: PrescriptionStatus.ORDERED,
          supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE,
        },
        data: {
          status: PrescriptionStatus.DISPENSED,
          dispensedAt,
          dispensedByStaffId: actor.id,
        },
      });

      if (claim.count === 0) {
        // Say WHY, from the row as it stands — without pretending the claim
        // could be retried into success.
        if (prescription.status === PrescriptionStatus.DISPENSED) {
          throw new BadRequestException('This medication has already been dispensed.');
        }
        if (prescription.status !== PrescriptionStatus.ORDERED) {
          throw new BadRequestException(`Cannot dispense a prescription in status ${prescription.status}`);
        }
        throw new BadRequestException(
          'Only medication marked for clinic dispensing can be dispensed. Set the supply mode first.',
        );
      }

      const tenantId = currentTenantId();
      // WAVE 2 — through the ONE ledger writer, so a dispense reaches a stock
      // level exactly the way a receipt, a transfer and a stock-take
      // correction do.
      await postMovement(tx, {
        tenantId,
        clinicId: visit.clinicId,
        itemId: prescription.itemId,
        movementType: StockMovementType.DISPENSED,
        // Stock units out, dose units beside them. Both, so the row explains
        // itself without a join to an item whose divisor may move later.
        quantityDelta: -dispense.dispenseQuantity,
        clinicalQuantity: dispense.clinicalQuantity,
        referenceType: 'Prescription',
        referenceId: prescription.id,
        // The ACTOR, not a blank: the ledger says who moved the stock.
        createdByUserId: actor.userId,
        createdByStaffId: actor.id,
      });

      return tx.prescription.findUnique({ where: { id }, include: { item: true, prescribedBy: true } });
    });
  }

  async cancel(id: string, dto: CancelPrescriptionDto) {
    const prescription = await this.findById(id);
    assertStatus(prescription.status, PrescriptionStatus.ORDERED, 'cancel');
    return this.prisma.prescription.update({
      where: { id },
      data: { status: PrescriptionStatus.CANCELLED, cancelReason: dto.cancelReason },
    });
  }

  // No hard delete (docs/DATABASE_ARCHITECTURE.md §1) — only while still
  // ORDERED, since DISPENSED already moved stock and CANCELLED is already
  // a terminal, audited state.
  async remove(id: string) {
    const prescription = await this.findById(id);
    assertStatus(prescription.status, PrescriptionStatus.ORDERED, 'delete');
    await this.prisma.prescription.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

function assertStatus(current: PrescriptionStatus, required: PrescriptionStatus, action: string): void {
  if (current !== required) {
    throw new BadRequestException(`Cannot ${action} a prescription in status ${current}`);
  }
}
