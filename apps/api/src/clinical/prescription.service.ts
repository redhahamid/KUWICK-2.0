import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DosageCalcMethod, PrescriptionStatus, PrescriptionSupplyMode, StockMovementType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { assertMayTouchVisit, requireActor, requireClinicalAuthor, withTenantTx } from './clinical-actor';
import { VisitService } from './visit.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { CancelPrescriptionDto } from './dto/cancel-prescription.dto';
import { CopyPrescriptionsDto } from './dto/copy-prescriptions.dto';
import { UpdateSupplyModeDto } from './dto/update-supply-mode.dto';
import { calculateWeightBasedDose, findAgeBracket } from './dosage-calculator';

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

    return this.prisma.prescription.create({
      data: {
        tenantId: currentTenantId(),
        visitId: dto.visitId,
        itemId: dto.itemId,
        quantity: dto.quantity,
        amount,
        unit: dto.unit,
        frequency: dto.frequency,
        durationDays: dto.durationDays,
        indication: dto.indication,
        remark: dto.remark,
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
        data: { supplyMode: dto.supplyMode },
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

  async copyFromVisit(dto: CopyPrescriptionsDto) {
    const author = await requireClinicalAuthor(this.prisma, 'prescribe medication');
    const targetVisit = await this.visits.findById(dto.targetVisitId);
    const sourcePrescriptions = await this.prisma.prescription.findMany({
      where: { visitId: dto.sourceVisitId, deletedAt: null },
    });

    const tenantId = currentTenantId();
    return Promise.all(
      sourcePrescriptions.map((source) =>
        this.prisma.prescription.create({
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
            // Copying a previous visit's medication is a NEW prescribing
            // decision, so it is authored by whoever made it — not inherited
            // from the source prescription and not from the target visit.
            prescribedByStaffId: author.id,
          },
        }),
      ),
    );
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
      const prescription = await tx.prescription.findUnique({ where: { id } });
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
      await tx.stockMovement.create({
        data: {
          tenantId,
          clinicId: visit.clinicId,
          itemId: prescription.itemId,
          movementType: StockMovementType.DISPENSED,
          quantityDelta: -prescription.quantity,
          referenceType: 'Prescription',
          referenceId: prescription.id,
          // The ACTOR, not a blank: the ledger says who moved the stock.
          createdByUserId: actor.userId,
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
          quantityOnHand: -prescription.quantity,
        },
        update: { quantityOnHand: { decrement: prescription.quantity } },
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
