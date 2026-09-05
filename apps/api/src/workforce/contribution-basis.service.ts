import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { catalogueFor } from './component-liability';
import { RecordContributionBasisDto } from './dto/record-contribution-basis.dto';

/**
 * THE EMPLOYER-SELECTED CONTRIBUTION BASIS — capture and history.
 *
 * Two concepts, deliberately apart, and this service owns only the second:
 *
 *  - The ASSESSMENT — which components ARE EPF wages — lives in the
 *    pay-component catalogue, per component, dated, with a verification
 *    status and a source. Nothing here reads or writes a liability flag.
 *  - The SELECTION — which of those wages the employer has CHOSEN to
 *    contribute on — is what these rows record: mode, ticked codes, a date,
 *    a required reason and the name of whoever decided.
 *
 * A selection that leaves assessed wages out is stored faithfully (it is the
 * employer's auditable preference) and the RUN raises the blocking statutory
 * discrepancy against it. Storing it is not endorsing it, and this service
 * says so in the capture response rather than leaving the discovery to the
 * exception centre.
 *
 * Permission shape mirrors salary exactly: reading pay structure is
 * `hr.salary.view`; writing it takes `hr.employee.manage` AND payroll access,
 * because a basis decides other people's statutory money.
 */
@Injectable()
export class ContributionBasisService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * History plus the vocabulary the selection editor needs: every EARNING
   * component in today's catalogue with its EPF assessment and verification,
   * so the panel can show "EPF wages" / "outside EPF wages" beside each tick
   * without a second source of truth growing in the browser.
   */
  async history(staffId: string) {
    await requirePermission(this.rawPrisma, 'hr.salary.view');
    const profile = await this.prisma.employeeProfile.findFirst({ where: { staffId } });
    if (!profile) throw new NotFoundException('Employee not found');

    const rows = await this.prisma.employeeContributionBasis.findMany({
      where: { staffId, scheme: 'EPF' },
      orderBy: { effectiveFrom: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });

    const catalogueRows = await this.prisma.payComponent.findMany({ where: {} });
    const catalogue = catalogueFor(catalogueRows, new Date());
    const components = [...catalogue.values()]
      .filter((component) => component.kind === 'EARNING')
      .map((component) => ({
        code: component.code,
        label: component.label,
        epfLiable: component.liability.epf,
        verification: component.verification,
        sourceRef: component.sourceRef,
      }))
      .sort((a, b) => (a.code === 'BASIC' ? -1 : b.code === 'BASIC' ? 1 : a.label.localeCompare(b.label)));

    return {
      scheme: 'EPF',
      versions: rows.map((row) => ({
        id: row.id,
        mode: row.mode,
        includedComponentCodes: row.includedComponentCodes,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
        reason: row.reason,
        note: row.note,
        recordedBy: row.createdBy?.fullName ?? null,
        recordedAt: row.createdAt.toISOString(),
        current: !row.effectiveTo,
        /** Closed into an empty interval by a same-day re-record: never in
         * force for any period, kept because the decision was still made. */
        superseded: row.effectiveTo !== null && row.effectiveTo < row.effectiveFrom,
      })),
      components,
    };
  }

  async record(staffId: string, dto: RecordContributionBasisDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      // Same rule as the salary and the bank field: `hr.employee.manage` says
      // who maintains employee records, payroll access says who may touch the
      // money — and a contribution basis IS the money.
      if (!actorCan(actor, 'hr.payroll.view')) {
        throw new ForbiddenException(
          'Selecting a contribution basis needs payroll access, not employee-record access alone.',
        );
      }
      const profile = await tx.employeeProfile.findFirst({ where: { staffId } });
      if (!profile) throw new NotFoundException('Employee not found');

      const from = new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('effectiveFrom must be a YYYY-MM-DD date.');

      /*
       * THE TICKED CODES ARE VOCABULARY, so they are checked against the
       * catalogue in force on the selection's own start date — an unknown
       * code would sit in the row meaning nothing forever. BASIC is always
       * in the basis and never stored: keeping it out of the column means
       * there is exactly one statement of that rule (the engine's), not two
       * that can drift.
       */
      let includedCodes: string[] = [];
      if (dto.mode === 'BASIC_PLUS_SELECTED') {
        const provided = [...new Set(dto.includedComponentCodes ?? [])].filter((code) => code !== 'BASIC');
        const catalogue = catalogueFor(await tx.payComponent.findMany({ where: {} }), from);
        for (const code of provided) {
          const component = catalogue.get(code);
          if (!component) {
            throw new BadRequestException(
              `"${code}" is not a pay component in force on ${dto.effectiveFrom}, so it cannot be part of a basis.`,
            );
          }
          if (component.kind !== 'EARNING') {
            throw new BadRequestException(
              `${component.label} is not an earning — a contribution basis selects income, not deductions.`,
            );
          }
        }
        includedCodes = provided;
      } else if (dto.includedComponentCodes && dto.includedComponentCodes.length > 0) {
        throw new BadRequestException(
          `Ticked components only make sense with "basic + selected income". Under "${
            dto.mode === 'BASIC_ONLY' ? 'basic salary only' : 'all applicable earnings'
          }" the list is decided by the mode itself.`,
        );
      }

      // A basis change inside an already-approved period would make the
      // approved run and the record disagree — same guard as the salary.
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
            'What they were contributed on is settled. Record the change from a period that has not been approved, or reopen the run and correct it deliberately.',
        );
      }

      /*
       * WHAT IS RECORDED FROM DAY F BECOMES THE SELECTION FROM F ONWARDS —
       * the one correction rule a clinic owner can hold in their head.
       *
       * Every LIVE row starting on or after F is SUPERSEDED: closed into an
       * empty interval (effectiveTo before its own effectiveFrom) that
       * resolution ignores and history keeps, so a selection tried and
       * reverted leaves a truthful trail instead of a dead end — a month
       * mid-period-blocked by an experiment can always be reunified by
       * recording the intended selection from the intended day. The row
       * governing the eve of F is (re)closed at F−1: its recorded FACTS —
       * mode, codes, date, reason, author — are never edited; only its
       * derived in-force window is, and only because the rows that used to
       * define that window have just been replaced.
       *
       * Safe because of the guard above: everything from F onward is
       * unapproved territory, so no approved run ever resolved what this
       * replaces.
       */
      const allRows = await tx.employeeContributionBasis.findMany({
        where: { staffId, scheme: dto.scheme },
        orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      });
      const isSuperseded = (row: { effectiveFrom: Date; effectiveTo: Date | null }) =>
        row.effectiveTo !== null && row.effectiveTo < row.effectiveFrom;
      const live = allRows.filter((row) => !isSuperseded(row));
      const future = live.filter((row) => row.effectiveFrom >= from);
      const prior = [...live].reverse().find((row) => row.effectiveFrom < from) ?? null;
      const governing =
        [...live]
          .reverse()
          .find((row) => row.effectiveFrom <= from && (row.effectiveTo === null || row.effectiveTo >= from)) ?? null;

      // A record that changes nothing from F onward is a row with no fact in
      // it. Replacing recorded-but-different future rows IS a change, even
      // when the content matches what governs today.
      if (
        future.length === 0 &&
        governing &&
        governing.mode === dto.mode &&
        [...governing.includedComponentCodes].sort().join(',') === [...includedCodes].sort().join(',')
      ) {
        throw new BadRequestException(
          'Nothing in this basis differs from the one already in force, so there is no new fact to record.',
        );
      }

      const dayBefore = new Date(from.getTime() - 86400000);
      for (const row of future) {
        await tx.employeeContributionBasis.update({
          where: { id: row.id },
          data: { effectiveTo: new Date(row.effectiveFrom.getTime() - 86400000) },
        });
      }
      if (prior) {
        await tx.employeeContributionBasis.update({ where: { id: prior.id }, data: { effectiveTo: dayBefore } });
      }

      const saved = await tx.employeeContributionBasis.create({
        data: {
          tenantId: currentTenantId(),
          staffId,
          scheme: dto.scheme,
          mode: dto.mode,
          includedComponentCodes: includedCodes,
          effectiveFrom: from,
          reason: dto.reason,
          note: dto.note ?? null,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'employeeContributionBasis.recorded',
        entityType: 'EmployeeContributionBasis',
        entityId: saved.id,
        reason: `Selected ${dto.mode} EPF basis from ${dto.effectiveFrom}: ${dto.reason}`,
        before: governing
          ? { mode: governing.mode, includedComponentCodes: governing.includedComponentCodes }
          : null,
        after: {
          mode: dto.mode,
          includedComponentCodes: includedCodes,
          effectiveFrom: dto.effectiveFrom,
          supersededRows: future.length,
        },
      });

      return {
        id: saved.id,
        mode: saved.mode,
        includedComponentCodes: saved.includedComponentCodes,
        effectiveFrom: dto.effectiveFrom,
        // Storing a preference is not endorsing it. Whether this selection
        // leaves assessed wages out is a fact about a MONTH's actual pay, so
        // the run decides it — and blocks on it — at calculation time.
        notEndorsed:
          dto.mode === 'ALL_APPLICABLE'
            ? null
            : 'Recorded as the employer’s selection. If a month pays EPF-liable income this basis leaves out, ' +
              'that month will show a statutory discrepancy and cannot be approved until it is resolved.',
      };
    });
  }
}
