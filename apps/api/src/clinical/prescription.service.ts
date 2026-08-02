import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DosageCalcMethod, PrescriptionStatus, StockMovementType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { CancelPrescriptionDto } from './dto/cancel-prescription.dto';
import { CopyPrescriptionsDto } from './dto/copy-prescriptions.dto';
import { calculateWeightBasedDose, findAgeBracket } from './dosage-calculator';

@Injectable()
export class PrescriptionService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly visits: VisitService,
  ) {}

  // Snapshots dose/unit/frequency/duration/indication from Item at
  // prescribe-time (same convention as Diagnosis/OrderService) and
  // defaults prescribedByStaffId to the visit's attending physician — no
  // real auth/user-identity exists yet (D-017), same gap as OrderService.
  //
  // The calculator exists "to prevent wrong dosage" (owner, D-028), so the
  // dose is never trusted verbatim from the client: WEIGHT_BASED is
  // recomputed server-side from calcWeightKg/calcDoseRateMgKg and the
  // item's configured concVolMl/strengthMg; AGE_BASED must match one of
  // the item's configured ItemAgeDosage brackets exactly. Only MANUAL (or
  // no calcMethod — the doctor typed the dose directly) is taken as-is.
  async create(dto: CreatePrescriptionDto) {
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
        prescribedByStaffId: visit.staffId,
      },
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
            prescribedByStaffId: targetVisit.staffId,
          },
        }),
      ),
    );
  }

  // ORDERED -> DISPENSED. Only now does stock move (D-028): a StockMovement
  // ledger row plus the cached StockLevel decrement, mirroring
  // GoodsReceivingService's write pattern in the negative direction.
  // Allowed to go negative, same as every other stock movement (D-020).
  async dispense(id: string) {
    const prescription = await this.findById(id);
    assertStatus(prescription.status, PrescriptionStatus.ORDERED, 'dispense');
    const visit = await this.visits.findById(prescription.visitId);
    const tenantId = currentTenantId();

    await this.prisma.stockMovement.create({
      data: {
        tenantId,
        clinicId: visit.clinicId,
        itemId: prescription.itemId,
        movementType: StockMovementType.DISPENSED,
        quantityDelta: -prescription.quantity,
        referenceType: 'Prescription',
        referenceId: prescription.id,
      },
    });

    await this.prisma.stockLevel.upsert({
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

    return this.prisma.prescription.update({
      where: { id },
      data: { status: PrescriptionStatus.DISPENSED, dispensedAt: new Date() },
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
