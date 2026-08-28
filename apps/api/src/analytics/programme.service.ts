import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { fromCents, toCents } from '../finance/money';
import { UpsertProgrammeDto } from './dto/upsert-programme.dto';
import { EnrolPatientDto } from './dto/enrol-patient.dto';

/**
 * PROGRAMMES — NCD, weight management, antenatal, as configuration.
 *
 * THE RULE THAT MATTERS MOST HERE (owner brief §2C): "DO NOT fabricate clinical
 * indicators from missing data." A programme dashboard reports what the clinic
 * actually recorded. Where there is no structured HbA1c, it says the indicator
 * is not captured — it does not compute a control rate from an empty set and
 * present it as a percentage.
 *
 * Everything below is therefore either a COUNT of records that exist (visits,
 * dispensings, enrolments, sales) or an explicit statement that a measure is
 * unavailable. There is no third category.
 */
@Injectable()
export class ProgrammeService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list() {
    await requirePermission(this.rawPrisma, 'analytics.view');
    const programmes = await this.prisma.clinicProgramme.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { enrolments: true } } },
    });
    return programmes.map((programme) => ({
      id: programme.id,
      name: programme.name,
      code: programme.code,
      description: programme.description,
      active: programme.active,
      serviceCatalogIds: programme.serviceCatalogIds,
      itemIds: programme.itemIds,
      diagnosisCodes: programme.diagnosisCodes,
      enrolments: programme._count.enrolments,
    }));
  }

  async upsert(dto: UpsertProgrammeDto) {
    return withAdminTx(this.rawPrisma, 'analytics.configure', async (tx) => {
      const existing = dto.id ? await tx.clinicProgramme.findUnique({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Programme not found');
      const data = {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        serviceCatalogIds: dto.serviceCatalogIds ?? [],
        itemIds: dto.itemIds ?? [],
        diagnosisCodes: dto.diagnosisCodes ?? [],
        active: dto.active ?? true,
      };
      return existing
        ? tx.clinicProgramme.update({ where: { id: existing.id }, data })
        : tx.clinicProgramme.create({ data: { ...data, tenantId: currentTenantId() } });
    });
  }

  /** Enrolment is a decision a clinician makes. Nothing auto-enrols anybody. */
  async enrol(dto: EnrolPatientDto) {
    return withAdminTx(this.rawPrisma, 'analytics.view', async (tx, actor) => {
      const enrolledAt = new Date(`${dto.enrolledAt ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      return tx.programmeEnrolment.upsert({
        where: {
          programmeId_patientId_enrolledAt: { programmeId: dto.programmeId, patientId: dto.patientId, enrolledAt },
        },
        create: {
          tenantId: currentTenantId(),
          programmeId: dto.programmeId,
          patientId: dto.patientId,
          enrolledAt,
          notes: dto.notes,
          enrolledByStaffId: actor.id,
        },
        update: { notes: dto.notes },
      });
    });
  }

  /**
   * A programme's dashboard.
   *
   * Every number here counts records that exist. Where a measure would need
   * data the clinic does not capture, it appears in `unavailableMeasures` with
   * the reason — visible, and honest, rather than absent or invented.
   */
  async dashboard(programmeId: string, params: { clinicId?: string; from: string; to: string }) {
    const actor = await requirePermission(this.rawPrisma, 'analytics.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000);

    const programme = await this.prisma.clinicProgramme.findUnique({ where: { id: programmeId } });
    if (!programme) throw new NotFoundException('Programme not found');

    const [enrolments, newEnrolments] = await Promise.all([
      this.prisma.programmeEnrolment.findMany({
        where: { programmeId, exitedAt: null },
        include: {
          patient: {
            select: {
              id: true,
              name: true,
              dob: true,
              gender: true,
              visits: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
      }),
      this.prisma.programmeEnrolment.count({ where: { programmeId, enrolledAt: { gte: from, lt: to } } }),
    ]);

    const patientIds = enrolments.map((enrolment) => enrolment.patientId);

    // Programme ACTIVITY: the dispensings and services that make it measurable.
    const [dispensings, services, invoiceLines] = await Promise.all([
      programme.itemIds.length > 0
        ? this.prisma.prescription.findMany({
            where: {
              itemId: { in: programme.itemIds },
              status: 'DISPENSED',
              visit: {
                patientId: { in: patientIds },
                createdAt: { gte: from, lt: to },
                ...(clinicId ? { clinicId } : {}),
              },
            },
            select: { itemId: true, quantity: true, item: { select: { name: true, sellPrice: true, cost: true } } },
          })
        : Promise.resolve([]),
      programme.serviceCatalogIds.length > 0
        ? this.prisma.orderService.count({
            where: {
              serviceCatalogId: { in: programme.serviceCatalogIds },
              status: 'COMPLETED',
              visit: {
                patientId: { in: patientIds },
                createdAt: { gte: from, lt: to },
                ...(clinicId ? { clinicId } : {}),
              },
            },
          })
        : Promise.resolve(0),
      this.prisma.invoiceLine.findMany({
        where: {
          cancelledAt: null,
          OR: [
            ...(programme.itemIds.length ? [{ sourcePrescription: { itemId: { in: programme.itemIds } } }] : []),
            ...(programme.serviceCatalogIds.length
              ? [{ sourceOrderService: { serviceCatalogId: { in: programme.serviceCatalogIds } } }]
              : []),
          ],
          invoice: {
            status: { not: 'CANCELLED' as const },
            createdAt: { gte: from, lt: to },
            visit: { patientId: { in: patientIds }, ...(clinicId ? { clinicId } : {}) },
          },
        },
        select: {
          amount: true,
          lineDiscountAmount: true,
          quantity: true,
          sourcePrescription: { select: { item: { select: { cost: true } } } },
        },
      }),
    ]);

    const revenueCents = invoiceLines.reduce(
      (total, line) => total + toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0),
      0,
    );
    const costCents = invoiceLines.reduce(
      (total, line) => total + toCents(line.sourcePrescription?.item?.cost ?? 0) * line.quantity,
      0,
    );

    const byItem = new Map<string, { name: string; quantity: number }>();
    for (const dispensing of dispensings) {
      const bucket = byItem.get(dispensing.itemId) ?? { name: dispensing.item.name, quantity: 0 };
      bucket.quantity += dispensing.quantity;
      byItem.set(dispensing.itemId, bucket);
    }

    const now = new Date();
    const withAge = enrolments.filter((enrolment) => enrolment.patient.dob !== null);
    return {
      programme: { id: programme.id, name: programme.name, code: programme.code },
      from: params.from,
      to: params.to,
      activePatients: enrolments.length,
      newEnrolments,
      demographics: {
        withRecordedAge: withAge.length,
        averageAge:
          withAge.length === 0
            ? null
            : Math.round(
                withAge.reduce(
                  (total, enrolment) => total + (now.getTime() - enrolment.patient.dob!.getTime()) / (365.25 * 86400000),
                  0,
                ) / withAge.length,
              ),
      },
      activity: {
        proceduresCompleted: services,
        dispensings: dispensings.length,
        unitsDispensed: dispensings.reduce((total, dispensing) => total + dispensing.quantity, 0),
        byItem: [...byItem.entries()]
          .map(([itemId, bucket]) => ({ itemId, name: bucket.name, quantity: bucket.quantity }))
          .sort((a, b) => b.quantity - a.quantity),
      },
      financials: {
        revenue: fromCents(revenueCents),
        directCost: fromCents(costCents),
        grossProfit: fromCents(revenueCents - costCents),
        basis:
          'Gross profit is programme revenue less direct item cost. No overhead is allocated, so this is a contribution figure.',
      },
      // THE HONEST GAP. Every measure this dashboard would like to show and
      // cannot, with the reason — never a fabricated percentage.
      unavailableMeasures: [
        {
          measure: 'Clinical control rate (HbA1c, blood pressure, cholesterol)',
          reason:
            'Kuwick records observations as free-form vitals, not as structured lab results with reference ranges. A control rate cannot be derived from what is captured, and this system will not estimate one.',
        },
        {
          measure: 'Dose ladder progression',
          reason:
            'Prescriptions record a dose per visit but no programme-level titration plan, so progression against a ladder is not computable from stored data.',
        },
      ],
      patients: enrolments.map((enrolment) => ({
        patientId: enrolment.patientId,
        name: enrolment.patient.name,
        gender: enrolment.patient.gender,
        enrolledAt: enrolment.enrolledAt,
        lastVisitAt: enrolment.patient.visits[0]?.createdAt ?? null,
      })),
    };
  }
}
