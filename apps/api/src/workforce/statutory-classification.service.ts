import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, withAdminTx } from '../finance/admin-actor';
import { ActingStaff } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';
import { hrdLevyRatePercent } from '../statutory/hrd-levy';
import {
  CLASSIFICATION_FIELDS,
  ClassificationField,
  StatutoryClassificationRow,
  classificationDiff,
  resolveClassificationForPayroll,
  resolveEmployerProfileForPayroll,
  storedChangedFields,
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
  restDayVaries?: boolean;
  restDayFollowsRoster?: boolean;
  overtimeContractPolicy: StatutoryClassificationRow['overtimeContractPolicy'];
  additionalPcbCents?: number;
  additionalPcbNote?: string | null;
  /** The JSON column: what the row was recorded as changing, or null before the column existed. */
  changedFields?: unknown;
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
    restDayVaries: row.restDayVaries ?? false,
    restDayFollowsRoster: row.restDayFollowsRoster ?? false,
    overtimeContractPolicy: row.overtimeContractPolicy,
    additionalPcbCents: row.additionalPcbCents ?? 0,
    additionalPcbNote: row.additionalPcbNote ?? null,
  };
}

/**
 * The standing a statement leaves behind: the base carried forward, and only
 * what was actually sent applied on top.
 *
 * Shared by both paths on purpose. A correction and a new version have to mean
 * the same thing by "what you did not send, you did not change", or a clerk
 * completing January would silently blank the EPF Part that January already
 * had.
 */
function applyToBase(
  base: StatutoryClassificationRow | null,
  dto: RecordStatutoryClassificationDto,
): Omit<StatutoryClassificationRow, 'id' | 'effectiveFrom' | 'effectiveTo'> {
  const pick = <K extends ClassificationField>(key: K, fallback: StatutoryClassificationRow[K]) =>
    (dto[key as keyof RecordStatutoryClassificationDto] === undefined
      ? (base?.[key] ?? fallback)
      : dto[key as keyof RecordStatutoryClassificationDto]) as StatutoryClassificationRow[K];

  /*
   * THE REST DAY IS ONE ANSWER IN THREE COLUMNS: a weekday, "varies", or
   * "varies, and the roster gives it". Following the roster always means no
   * weekday and varying; naming a weekday or a fixed day ends it.
   */
  const followsRoster = dto.restDayFollowsRoster === true;
  const restDayOfWeek = followsRoster ? null : pick('restDayOfWeek', null);
  const restDayVaries = followsRoster ? true : pick('restDayVaries', false);
  const restDayFollowsRoster = followsRoster || (restDayVaries && restDayOfWeek === null && pick('restDayFollowsRoster', false));

  return {
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
    restDayOfWeek,
    restDayVaries,
    restDayFollowsRoster,
    overtimeContractPolicy: pick('overtimeContractPolicy', null),
    additionalPcbCents: pick('additionalPcbCents', 0),
    additionalPcbNote: pick('additionalPcbNote', null),
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
      // What the row was RECORDED as changing, where that was written down;
      // the live diff only for rows older than the column.
      const changed: ClassificationField[] =
        storedChangedFields(row.changedFields) ??
        (previous ? classificationDiff(toClassificationRow(previous), toClassificationRow(row)) : []);
      return {
        id: row.id,
        effectiveFrom: isoDate(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null,
        current: !row.effectiveTo,
        /** The earliest version on record: nothing before it to have changed from. */
        first: index === 0,
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
        restDayVaries: row.restDayVaries,
        restDayFollowsRoster: row.restDayFollowsRoster,
        overtimeContractPolicy: row.overtimeContractPolicy,
        additionalPcbCents: row.additionalPcbCents,
        additionalPcbNote: row.additionalPcbNote,
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
   *
   * WHERE A STANDING ALREADY STARTS ON THAT DATE, THIS RESTATES IT.
   *
   * Two versions cannot both start on the same day — one of them would have a
   * range of no days — so a same-date statement can only ever have meant the
   * row that is there. It used to be refused outright, which was unreachable
   * advice: the first standing an employee ever has is written from their JOIN
   * DATE by the Add employee form and carries only the three things that form
   * asks for. Everything else about their first month — LINDUNG, the rest day,
   * the MTD category — has nowhere else to go, because there is no earlier
   * date to record it from and a later date leaves that month unanswered.
   */
  async record(staffId: string, dto: RecordStatutoryClassificationDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const profile = await tx.employeeProfile.findFirst({ where: { staffId } });
      if (!profile) throw new NotFoundException('Employee not found');

      const from = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('effectiveFrom must be a YYYY-MM-DD date.');

      /*
       * AN APPROVED MONTH IS SETTLED.
       *
       * The same refusal a salary change gets, for the same reason and with
       * more force: a classification change dated into an approved period
       * would leave the approved run's snapshot and the employee record giving
       * different answers about which EPF Part was used, and the run is the
       * one the employee was paid from. Restating a row is no different —
       * arguably worse, since it leaves no second version to notice.
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

      // Before anything reorders this employee's chain, write down what each
      // older row currently reads as changing, so that text stays theirs.
      await this.freezeChangedFields(tx, staffId);

      const standing = await tx.employeeStatutoryClassification.findFirst({ where: { staffId, effectiveFrom: from } });
      if (standing) return this.correct(tx, actor, staffId, standing, dto, from);

      /*
       * ANY PAST DATE, BY SPLITTING THE ROW THAT COVERS IT.
       *
       * A change used to be accepted only after the row in force, so a clinic
       * that recorded anything today could never enter a change that had
       * genuinely taken effect earlier in the year — refused with "the current
       * classification starts on 1 September, which is not before 1 June".
       * Mid-year migration and back-entry are exactly that: SKBBK from June,
       * recorded in September, is an ordinary month, not an edge case.
       *
       * So the version covering the date is split. The earlier part keeps
       * what it said, and the new version runs from the date to wherever the
       * old one ran to — the day before the next version, or open. Nothing
       * after it moves. A date before the first version gets a version that
       * ends the day before it, on the defaults, since nothing was in force
       * to carry forward. What protects the settled months is the approved-run
       * refusal above, which is the same for a change dated today.
       */
      const covering = await tx.employeeStatutoryClassification.findFirst({
        where: { staffId, effectiveFrom: { lt: from }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      const following = covering
        ? null
        : await tx.employeeStatutoryClassification.findFirst({
            where: { staffId, effectiveFrom: { gt: from } },
            orderBy: { effectiveFrom: 'asc' },
          });

      // Carry the standing in force on that date forward, then apply what was sent.
      const base = covering ? toClassificationRow(covering) : null;
      const next = applyToBase(base, dto);
      const runsTo = covering ? covering.effectiveTo : following ? new Date(following.effectiveFrom.getTime() - 86400000) : null;

      // A version that states nothing new is a row with no fact in it. It would
      // also be indistinguishable, in the history, from a change somebody
      // meant to make and got wrong.
      const changed: ClassificationField[] = base
        ? classificationDiff(base, { ...next, id: '', effectiveFrom: from, effectiveTo: runsTo })
        : [];
      if (base && changed.length === 0) {
        throw new BadRequestException(
          'Nothing in this classification differs from the one in force on that date, so there is no new fact to record.',
        );
      }

      if (covering) {
        await tx.employeeStatutoryClassification.update({
          where: { id: covering.id },
          data: { effectiveTo: new Date(from.getTime() - 86400000) },
        });
      }

      const saved = await tx.employeeStatutoryClassification.create({
        data: {
          tenantId: currentTenantId(),
          staffId,
          ...next,
          effectiveFrom: from,
          effectiveTo: runsTo,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
          // What this row changed against the one in force on its date, kept
          // as recorded: a version slid in before it later does not alter it.
          changedFields: changed,
          createdByStaffId: actor.id,
        },
      });

      const appliedToLater = dto.applyToLater && base ? await this.carryIntoLater(tx, staffId, from, base, next, changed) : [];

      await recordAudit(tx, actor, {
        action: 'employeeStatutoryClassification.recorded',
        entityType: 'EmployeeStatutoryClassification',
        entityId: saved.id,
        reason:
          `Recorded statutory classification from ${dto.effectiveFrom}` +
          (appliedToLater.length > 0 ? `, applied to ${appliedToLater.length} later version(s)` : ''),
        before: base ? (base as unknown as Record<string, unknown>) : null,
        after: { ...next, effectiveFrom: dto.effectiveFrom, appliedToLater } as unknown as Record<string, unknown>,
        source: 'hr.employees',
      });

      return { ...saved, appliedToLater };
    });
  }

  /**
   * THE LATER VERSIONS, IF ASKED.
   *
   * A change dated into the past is usually a fact that still holds: an SKBBK
   * opt-out from June is an opt-out in September too, unless September's own
   * version said otherwise. So each later version takes the changed fields
   * WHERE IT STILL CARRIES THE OLD VALUE, and keeps anything it changed
   * deliberately. What it was recorded as changing stays as it was: the list
   * is the row's own, not a function of its neighbours.
   */
  private async carryIntoLater(
    tx: AdminTx,
    staffId: string,
    from: Date,
    base: StatutoryClassificationRow,
    next: ReturnType<typeof applyToBase>,
    changed: ClassificationField[],
  ): Promise<{ id: string; effectiveFrom: string; fields: ClassificationField[] }[]> {
    if (changed.length === 0) return [];
    const later = await tx.employeeStatutoryClassification.findMany({
      where: { staffId, effectiveFrom: { gt: from } },
      orderBy: { effectiveFrom: 'asc' },
    });
    const carried: { id: string; effectiveFrom: string; fields: ClassificationField[] }[] = [];
    for (const version of later) {
      const held = toClassificationRow(version);
      const fields = changed.filter((key) => held[key] === base[key]);
      if (fields.length === 0) continue;
      const data = Object.fromEntries(fields.map((key) => [key, next[key]])) as Partial<typeof next>;
      await tx.employeeStatutoryClassification.update({ where: { id: version.id }, data });
      carried.push({ id: version.id, effectiveFrom: isoDate(version.effectiveFrom), fields });
    }
    return carried;
  }

  /**
   * KEEP WHAT EACH VERSION WAS RECORDED AS CHANGING.
   *
   * Rows written before `changedFields` existed carry no list, so their "what
   * changed" is diffed live against whichever row happens to sit before them.
   * The first thing that reorders the chain — a back-dated version, a delete,
   * a correction — would then rewrite their text. So before any of those, the
   * live text of every such row is written down once, in chronological order,
   * and is never recomputed again.
   */
  private async freezeChangedFields(tx: AdminTx, staffId: string): Promise<void> {
    const rows = await tx.employeeStatutoryClassification.findMany({ where: { staffId }, orderBy: { effectiveFrom: 'asc' } });
    for (const [index, row] of rows.entries()) {
      if (storedChangedFields(row.changedFields) !== null) continue;
      const previous = index > 0 ? rows[index - 1] : null;
      const changed = previous ? classificationDiff(toClassificationRow(previous), toClassificationRow(row)) : [];
      await tx.employeeStatutoryClassification.update({ where: { id: row.id }, data: { changedFields: changed } });
    }
  }

  /**
   * Restate the standing that already starts on that date, in place.
   *
   * The row keeps its dates and its original recorder; the audit row carries
   * who restated it and what it said before. Nothing about the shape of the
   * history changes — the same number of versions, the same ranges — because
   * this is not a change of standing, it is the same standing said properly.
   *
   * Asking for what the row already says is not an error. A screen that is
   * ambiguous about whether it saved makes people press the button twice, and
   * being told "duplicate" for pressing it twice teaches them to distrust a
   * save that worked.
   */
  private async correct(
    tx: AdminTx,
    actor: ActingStaff,
    staffId: string,
    standing: PrismaClassification & { reason: string | null; note: string | null },
    dto: RecordStatutoryClassificationDto,
    from: Date,
  ) {
    const base = toClassificationRow(standing);
    const next = applyToBase(base, dto);
    const changed = classificationDiff(base, { ...next, id: standing.id, effectiveFrom: from, effectiveTo: standing.effectiveTo });
    const reason = dto.reason ?? standing.reason;
    const note = dto.note ?? standing.note;

    if (changed.length === 0 && reason === standing.reason && note === standing.note) return { ...standing, appliedToLater: [] };

    // A restated row is a different statement, so what it changes against the
    // version before it is worked out again — for this row only.
    const previous = await tx.employeeStatutoryClassification.findFirst({
      where: { staffId, effectiveFrom: { lt: from } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const changedFields = previous
      ? classificationDiff(toClassificationRow(previous), { ...next, id: standing.id, effectiveFrom: from, effectiveTo: standing.effectiveTo })
      : [];

    const saved = await tx.employeeStatutoryClassification.update({
      where: { id: standing.id },
      data: { ...next, reason, note, changedFields },
    });
    // The same question a new version answers: do the later versions take it too.
    const appliedToLater = dto.applyToLater ? await this.carryIntoLater(tx, staffId, from, base, next, changed) : [];

    await recordAudit(tx, actor, {
      action: 'employeeStatutoryClassification.corrected',
      entityType: 'EmployeeStatutoryClassification',
      entityId: standing.id,
      reason: `Restated the statutory classification starting ${isoDate(from)}: ${
        changed.length > 0 ? changed.map((key) => CLASSIFICATION_FIELDS[key]).join(', ') : 'reason only'
      }`,
      before: base as unknown as Record<string, unknown>,
      after: { ...next, effectiveFrom: isoDate(from), appliedToLater } as unknown as Record<string, unknown>,
      source: 'hr.employees',
    });

    return { ...saved, appliedToLater };
  }

  /**
   * DELETE A VERSION RECORDED IN ERROR.
   *
   * Two versions that only exist because a form once moved the date to the
   * current month are not history, they are a mistake with a date on it. A
   * version no approved month reads can go, and the version before it runs
   * on to where the deleted one ran to, so the months in between keep an
   * answer. The first version has nothing before it: deleting it leaves the
   * months it covered unanswered, and the record says so rather than filling
   * them in.
   *
   * A version an APPROVED or PAID month was worked out from stays. That month's
   * contributions were computed from it, and a delete would leave the run
   * and the record disagreeing with nothing left to show which was right.
   */
  async remove(staffId: string, id: string, reason?: string) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const row = await tx.employeeStatutoryClassification.findFirst({ where: { id, staffId } });
      if (!row) throw new NotFoundException('That statutory classification is not on this employee’s record.');

      const monthOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const approved = await tx.payrollRun.findMany({
        where: {
          status: { in: ['APPROVED', 'PAID'] },
          lines: { some: { staffId } },
          period: { gte: monthOf(row.effectiveFrom), ...(row.effectiveTo ? { lte: row.effectiveTo } : {}) },
        },
        select: { period: true },
        orderBy: { period: 'asc' },
      });
      if (approved.length > 0) {
        const months = approved.map((run) => isoDate(run.period).slice(0, 7)).join(', ');
        throw new ConflictException(
          `An approved payroll run (${months}) was worked out from this version, so it stays. ` +
            'Reopen that run and correct it deliberately, or record a change from a later date.',
        );
      }

      // The version after the deleted one keeps what it was recorded as
      // changing; written down first where it was never kept.
      await this.freezeChangedFields(tx, staffId);

      const previous = await tx.employeeStatutoryClassification.findFirst({
        where: { staffId, effectiveFrom: { lt: row.effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (previous) {
        await tx.employeeStatutoryClassification.update({ where: { id: previous.id }, data: { effectiveTo: row.effectiveTo } });
      }
      await tx.employeeStatutoryClassification.delete({ where: { id } });

      await recordAudit(tx, actor, {
        action: 'employeeStatutoryClassification.deleted',
        entityType: 'EmployeeStatutoryClassification',
        entityId: id,
        reason: reason?.trim() || `Deleted the statutory classification starting ${isoDate(row.effectiveFrom)}`,
        before: {
          ...(toClassificationRow(row) as unknown as Record<string, unknown>),
          effectiveFrom: isoDate(row.effectiveFrom),
          effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null,
          reason: row.reason,
        },
        after: previous
          ? { previousVersion: previous.id, previousNowRunsTo: row.effectiveTo ? isoDate(row.effectiveTo) : null }
          : { previousVersion: null, gapFrom: isoDate(row.effectiveFrom), gapTo: row.effectiveTo ? isoDate(row.effectiveTo) : null },
        source: 'hr.employees',
      });

      return {
        deleted: true,
        extended: previous ? { id: previous.id, effectiveFrom: isoDate(previous.effectiveFrom), effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null } : null,
      };
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

      /*
       * A DATE ANYWHERE ON THE TIMELINE (UAT, 10 October 2026): "HRD
       * registration cannot be back-dated." A date after the record in force
       * starts a new version, as before. A date before or inside an existing
       * version either corrects that version's start (the same class as the
       * version it runs into: "registered from 1 January, not 1 September")
       * or inserts a version of its own up to the next one. Nothing is
       * deleted: a corrected start is an edit of the date, logged with the
       * old one. Refused, naming the months, when an approved month lies in
       * the period whose class would change.
       */
      const rows = await tx.legalEmployerStatutoryProfile.findMany({
        where: { legalEmployerId },
        orderBy: { effectiveFrom: 'asc' },
      });
      const dayBefore = (date: Date) => new Date(date.getTime() - 86400000);
      const next = rows.find((row) => row.effectiveFrom > from) ?? null;
      const governing = [...rows].reverse().find((row) => row.effectiveFrom < from) ?? null;
      const backDated = next !== null;
      if (governing && governing.hrdRegistration === dto.hrdRegistration && (!governing.effectiveTo || governing.effectiveTo >= from)) {
        throw new BadRequestException(
          `${employer.name} is already registered as ${dto.hrdRegistration} on ${dto.effectiveFrom}, so there is no new fact to record.`,
        );
      }
      if (backDated && !dto.reason?.trim()) {
        throw new BadRequestException('Say why the registration is being dated earlier: it is kept with the change.');
      }
      // The period whose class changes: from the date to the day before the next version, or open.
      const corrects = next !== null && next.hrdRegistration === dto.hrdRegistration;
      const changedUntil = next === null ? null : corrects ? dayBefore(next.effectiveFrom) : dayBefore(next.effectiveFrom);
      const approved = await tx.payrollRun.findMany({
        where: {
          legalEmployerId,
          status: { in: ['APPROVED', 'PAID'] },
          period: {
            gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)),
            ...(changedUntil ? { lte: changedUntil } : {}),
          },
        },
        select: { period: true },
        orderBy: { period: 'asc' },
      });
      if (approved.length > 0) {
        const months = [...new Set(approved.map((run) => run.period.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })))];
        throw new ConflictException(
          `${months.join(', ')} ${months.length === 1 ? 'is' : 'are'} approved for ${employer.name} and would be levied differently. ` +
            'Nothing was changed. Date the change after the last approved month, or correct those months with an adjustment.',
        );
      }

      // The version before the date stops the day before it.
      if (governing && (!governing.effectiveTo || governing.effectiveTo >= from)) {
        await tx.legalEmployerStatutoryProfile.update({ where: { id: governing.id }, data: { effectiveTo: dayBefore(from) } });
      }

      if (corrects && next) {
        // The same class as the version it runs into: that version simply started earlier.
        const saved = await tx.legalEmployerStatutoryProfile.update({
          where: { id: next.id },
          data: { effectiveFrom: from, reason: dto.reason ?? next.reason, note: dto.note ?? next.note },
        });
        await recordAudit(tx, actor, {
          action: 'legalEmployerStatutory.recorded',
          entityType: 'LegalEmployerStatutoryProfile',
          entityId: saved.id,
          reason: `Corrected the start of HRD registration ${dto.hrdRegistration} from ${isoDate(next.effectiveFrom)} to ${dto.effectiveFrom}: ${dto.reason}`,
          before: { hrdRegistration: next.hrdRegistration, effectiveFrom: isoDate(next.effectiveFrom) },
          after: { hrdRegistration: dto.hrdRegistration, effectiveFrom: dto.effectiveFrom },
          source: 'hr.employers',
        });
        return saved;
      }

      const saved = await tx.legalEmployerStatutoryProfile.create({
        data: {
          tenantId: currentTenantId(),
          legalEmployerId,
          hrdRegistration: dto.hrdRegistration,
          effectiveFrom: from,
          // Inserted before a later version: it ends where that one starts.
          effectiveTo: next ? dayBefore(next.effectiveFrom) : null,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'legalEmployerStatutory.recorded',
        entityType: 'LegalEmployerStatutoryProfile',
        entityId: saved.id,
        reason: `Recorded HRD registration ${dto.hrdRegistration} from ${dto.effectiveFrom}${next ? ` to ${isoDate(dayBefore(next.effectiveFrom))}` : ''}${dto.reason ? `: ${dto.reason}` : ''}`,
        before: governing ? { hrdRegistration: governing.hrdRegistration } : null,
        after: { hrdRegistration: dto.hrdRegistration, effectiveFrom: dto.effectiveFrom, effectiveTo: next ? isoDate(dayBefore(next.effectiveFrom)) : null },
        source: 'hr.employers',
      });

      return saved;
    });
  }
}
