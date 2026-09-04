import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { hrdLevyRatePercent } from '../statutory/hrd-levy';
import {
  CLASSIFICATION_FIELDS,
  ClassificationField,
  StatutoryClassificationRow,
  classificationDiff,
  resolveClassificationForPayroll,
  resolveEmployerProfileForPayroll,
} from './statutory-classification';
import {
  RecordEmployerStatutoryDto,
  RecordStatutoryClassificationDto,
} from './dto/record-statutory-classification.dto';

/** Inclusive first and last day of the month a date falls in, in UTC. */
function monthBounds(period: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1));
  const end = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));
  return { start, end };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

type PrismaClassification = {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  epfApplicable: boolean;
  epfMembership: StatutoryClassificationRow['epfMembership'];
  epfEmployeeRate: unknown;
  socsoApplicable: boolean;
  eisApplicable: boolean;
  lindungParticipation: StatutoryClassificationRow['lindungParticipation'];
  pcbApplicable: boolean;
  taxResidence: StatutoryClassificationRow['taxResidence'];
  pcbCategory: StatutoryClassificationRow['pcbCategory'];
  qualifyingChildren: number;
  disabledSelf: boolean;
  disabledSpouse: boolean;
  restDayOfWeek: number | null;
  overtimeContractPolicy: StatutoryClassificationRow['overtimeContractPolicy'];
};

/**
 * One database row as the pure resolver sees it.
 *
 * Exported because the payroll run maps the same shape, and two mappers would
 * be two chances for the run and the screen to disagree about somebody's EPF
 * Part.
 */
export function toClassificationRow(row: PrismaClassification): StatutoryClassificationRow {
  return {
    id: row.id,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    epfApplicable: row.epfApplicable,
    epfMembership: row.epfMembership,
    epfEmployeeRate: row.epfEmployeeRate === null || row.epfEmployeeRate === undefined ? null : Number(row.epfEmployeeRate),
    socsoApplicable: row.socsoApplicable,
    eisApplicable: row.eisApplicable,
    lindungParticipation: row.lindungParticipation,
    pcbApplicable: row.pcbApplicable,
    taxResidence: row.taxResidence,
    pcbCategory: row.pcbCategory,
    qualifyingChildren: row.qualifyingChildren,
    disabledSelf: row.disabledSelf,
    disabledSpouse: row.disabledSpouse,
    restDayOfWeek: row.restDayOfWeek,
    overtimeContractPolicy: row.overtimeContractPolicy,
  };
}

/**
 * STATUTORY STANDING AS A RECORD, NOT A FORM FIELD.
 *
 * Recording is `hr.employee.manage` — the same permission that maintains an
 * employment record — and reading is `hr.view`. Deliberately NOT gated on
 * payroll: an HR clerk has to be able to see that somebody's EPF Part is
 * missing without being able to see anybody's pay.
 */
@Injectable()
export class StatutoryClassificationService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------------
  // Employee
  // -------------------------------------------------------------------------

  async history(staffId: string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.employeeStatutoryClassification.findMany({
      where: { staffId },
      orderBy: { effectiveFrom: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });

    const ordered = [...rows].reverse();
    return rows.map((row) => {
      const index = ordered.findIndex((r) => r.id === row.id);
      const previous = index > 0 ? ordered[index - 1] : null;
      const changed: ClassificationField[] = previous
        ? classificationDiff(toClassificationRow(previous), toClassificationRow(row))
        : [];
      return {
        id: row.id,
        effectiveFrom: isoDate(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null,
        current: !row.effectiveTo,
        epfApplicable: row.epfApplicable,
        epfMembership: row.epfMembership,
        epfEmployeeRate: row.epfEmployeeRate === null ? null : Number(row.epfEmployeeRate),
        socsoApplicable: row.socsoApplicable,
        eisApplicable: row.eisApplicable,
        lindungParticipation: row.lindungParticipation,
        pcbApplicable: row.pcbApplicable,
        taxResidence: row.taxResidence,
        pcbCategory: row.pcbCategory,
        qualifyingChildren: row.qualifyingChildren,
        disabledSelf: row.disabledSelf,
        disabledSpouse: row.disabledSpouse,
        restDayOfWeek: row.restDayOfWeek,
        overtimeContractPolicy: row.overtimeContractPolicy,
        reason: row.reason,
        note: row.note,
        recordedBy: row.createdBy?.fullName ?? null,
        recordedAt: row.createdAt.toISOString(),
        /** What this version changed against the one before it, in words. */
        changed: changed.map((key) => CLASSIFICATION_FIELDS[key]),
      };
    });
  }

  /** What a given period resolves to, and why. The run asks the same question. */
  async resolveForPeriod(staffId: string, period: Date | string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const asDate = period instanceof Date ? period : new Date(`${period}T00:00:00.000Z`);
    if (Number.isNaN(asDate.getTime())) throw new BadRequestException('period must be a YYYY-MM-DD date.');
    const { start, end } = monthBounds(asDate);

    const rows = await this.prisma.employeeStatutoryClassification.findMany({ where: { staffId } });
    const outcome = resolveClassificationForPayroll(rows.map(toClassificationRow), start, end);

    return {
      period: isoDate(start),
      state: outcome.kind,
      reason: outcome.reason,
      classificationId: outcome.kind === 'RESOLVED' ? outcome.row.id : null,
      effectiveFrom: outcome.kind === 'RESOLVED' ? isoDate(outcome.row.effectiveFrom) : null,
      changed: outcome.kind === 'CHANGED_MID_PERIOD' ? outcome.changed.map((key) => CLASSIFICATION_FIELDS[key]) : [],
    };
  }

  /**
   * Record a statutory standing from a date.
   *
   * Closes the open row rather than editing it. The version in force is
   * carried forward and the sent fields applied on top, so a caller changing
   * one classification does not have to restate the other thirteen — and what
   * is stored is still the whole standing.
   */
  async record(staffId: string, dto: RecordStatutoryClassificationDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const profile = await tx.employeeProfile.findFirst({ where: { staffId } });
      if (!profile) throw new NotFoundException('Employee not found');

      const from = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('effectiveFrom must be a YYYY-MM-DD date.');

      const clash = await tx.employeeStatutoryClassification.findFirst({ where: { staffId, effectiveFrom: from } });
      if (clash) {
        throw new ConflictException(
          `A statutory classification already starts on ${dto.effectiveFrom} for this employee. ` +
            'Correct that row rather than adding a second one for the same day.',
        );
      }

      /*
       * AN APPROVED MONTH IS SETTLED.
       *
       * The same refusal a salary change gets, for the same reason and with
       * more force: a classification change dated into an approved period
       * would leave the approved run's snapshot and the employee record giving
       * different answers about which EPF Part was used, and the run is the
       * one the employee was paid from.
       */
      const approvedCovering = await tx.payrollRun.count({
        where: {
          status: { in: ['APPROVED', 'PAID'] },
          period: { gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)) },
          lines: { some: { staffId } },
        },
      });
      if (approvedCovering > 0) {
        throw new ConflictException(
          `${approvedCovering} approved payroll run(s) cover this date or later for this employee. ` +
            'What they were contributed is settled. Record the change from a period that has not been approved, ' +
            'or reopen the run and correct it deliberately.',
        );
      }

      const open = await tx.employeeStatutoryClassification.findFirst({
        where: { staffId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (open && open.effectiveFrom >= from) {
        throw new BadRequestException(
          `The current statutory classification starts on ${isoDate(open.effectiveFrom)}, which is not before ${dto.effectiveFrom}.`,
        );
      }

      // Carry the standing in force forward, then apply what was sent.
      const base = open ? toClassificationRow(open) : null;
      const pick = <K extends ClassificationField>(key: K, fallback: StatutoryClassificationRow[K]) =>
        (dto[key as keyof RecordStatutoryClassificationDto] === undefined
          ? (base?.[key] ?? fallback)
          : dto[key as keyof RecordStatutoryClassificationDto]) as StatutoryClassificationRow[K];

      const next: Omit<StatutoryClassificationRow, 'id' | 'effectiveFrom' | 'effectiveTo'> = {
        epfApplicable: pick('epfApplicable', true),
        epfMembership: pick('epfMembership', null),
        epfEmployeeRate: pick('epfEmployeeRate', null),
        socsoApplicable: pick('socsoApplicable', true),
        eisApplicable: pick('eisApplicable', true),
        lindungParticipation: pick('lindungParticipation', null),
        pcbApplicable: pick('pcbApplicable', true),
        taxResidence: pick('taxResidence', null),
        pcbCategory: pick('pcbCategory', null),
        qualifyingChildren: pick('qualifyingChildren', 0),
        disabledSelf: pick('disabledSelf', false),
        disabledSpouse: pick('disabledSpouse', false),
        restDayOfWeek: pick('restDayOfWeek', null),
        overtimeContractPolicy: pick('overtimeContractPolicy', null),
      };

      // A version that states nothing new is a row with no fact in it. It would
      // also be indistinguishable, in the history, from a change somebody
      // meant to make and got wrong.
      if (base) {
        const changed = classificationDiff(base, { ...next, id: '', effectiveFrom: from, effectiveTo: null });
        if (changed.length === 0) {
          throw new BadRequestException(
            'Nothing in this classification differs from the one already in force, so there is no new fact to record.',
          );
        }
      }

      if (open) {
        await tx.employeeStatutoryClassification.update({
          where: { id: open.id },
          data: { effectiveTo: new Date(from.getTime() - 86400000) },
        });
      }

      const saved = await tx.employeeStatutoryClassification.create({
        data: {
          tenantId: currentTenantId(),
          staffId,
          ...next,
          effectiveFrom: from,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'employeeStatutoryClassification.recorded',
        entityType: 'EmployeeStatutoryClassification',
        entityId: saved.id,
        reason: `Recorded statutory classification from ${dto.effectiveFrom}`,
        before: base ? (base as unknown as Record<string, unknown>) : null,
        after: { ...next, effectiveFrom: dto.effectiveFrom } as unknown as Record<string, unknown>,
        source: 'hr.employees',
      });

      return saved;
    });
  }

  // -------------------------------------------------------------------------
  // Employer
  // -------------------------------------------------------------------------

  async employerHistory(legalEmployerId: string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.legalEmployerStatutoryProfile.findMany({
      where: { legalEmployerId },
      orderBy: { effectiveFrom: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      effectiveFrom: isoDate(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null,
      current: !row.effectiveTo,
      hrdRegistration: row.hrdRegistration,
      /** Derived from the class, never stored: 1% and 0.5% are the Act's. */
      hrdLevyRatePercent: hrdLevyRatePercent(row.hrdRegistration),
      reason: row.reason,
      note: row.note,
      recordedBy: row.createdBy?.fullName ?? null,
      recordedAt: row.createdAt.toISOString(),
    }));
  }

  async resolveEmployerForPeriod(legalEmployerId: string, period: Date | string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const asDate = period instanceof Date ? period : new Date(`${period}T00:00:00.000Z`);
    if (Number.isNaN(asDate.getTime())) throw new BadRequestException('period must be a YYYY-MM-DD date.');
    const { start, end } = monthBounds(asDate);

    const rows = await this.prisma.legalEmployerStatutoryProfile.findMany({ where: { legalEmployerId } });
    const outcome = resolveEmployerProfileForPayroll(
      rows.map((row) => ({
        id: row.id,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        hrdRegistration: row.hrdRegistration,
      })),
      start,
      end,
    );
    return {
      period: isoDate(start),
      state: outcome.kind,
      reason: outcome.reason,
      hrdRegistration: outcome.kind === 'RESOLVED' ? outcome.row.hrdRegistration : null,
      hrdLevyRatePercent: outcome.kind === 'RESOLVED' ? hrdLevyRatePercent(outcome.row.hrdRegistration) : null,
    };
  }

  async recordEmployer(legalEmployerId: string, dto: RecordEmployerStatutoryDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const employer = await tx.legalEmployer.findUnique({ where: { id: legalEmployerId } });
      if (!employer) throw new NotFoundException('That employing company is not on file.');

      const from = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('effectiveFrom must be a YYYY-MM-DD date.');

      const clash = await tx.legalEmployerStatutoryProfile.findFirst({
        where: { legalEmployerId, effectiveFrom: from },
      });
      if (clash) {
        throw new ConflictException(
          `An HRD registration already starts on ${dto.effectiveFrom} for ${employer.name}. Correct that row instead.`,
        );
      }

      const approvedCovering = await tx.payrollRun.count({
        where: {
          legalEmployerId,
          status: { in: ['APPROVED', 'PAID'] },
          period: { gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)) },
        },
      });
      if (approvedCovering > 0) {
        throw new ConflictException(
          `${approvedCovering} approved payroll run(s) cover this date or later for ${employer.name}. ` +
            'Record the change from a period that has not been approved.',
        );
      }

      const open = await tx.legalEmployerStatutoryProfile.findFirst({
        where: { legalEmployerId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (open) {
        if (open.effectiveFrom >= from) {
          throw new BadRequestException(
            `The current HRD registration starts on ${isoDate(open.effectiveFrom)}, which is not before ${dto.effectiveFrom}.`,
          );
        }
        if (open.hrdRegistration === dto.hrdRegistration) {
          throw new BadRequestException(
            `${employer.name} is already registered as ${dto.hrdRegistration}, so there is no new fact to record.`,
          );
        }
        await tx.legalEmployerStatutoryProfile.update({
          where: { id: open.id },
          data: { effectiveTo: new Date(from.getTime() - 86400000) },
        });
      }

      const saved = await tx.legalEmployerStatutoryProfile.create({
        data: {
          tenantId: currentTenantId(),
          legalEmployerId,
          hrdRegistration: dto.hrdRegistration,
          effectiveFrom: from,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'legalEmployerStatutory.recorded',
        entityType: 'LegalEmployerStatutoryProfile',
        entityId: saved.id,
        reason: `Recorded HRD registration ${dto.hrdRegistration} from ${dto.effectiveFrom}`,
        before: open ? { hrdRegistration: open.hrdRegistration } : null,
        after: { hrdRegistration: dto.hrdRegistration, effectiveFrom: dto.effectiveFrom },
        source: 'hr.employers',
      });

      return saved;
    });
  }
}
