import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { STATUTORY_SCHEDULES, meetsApprovalBar, scheduleFor } from '../statutory/registry';
import { editionsFor } from '../statutory/editions';
import { EPF_PARTS, EPF_TABLE_CEILING_CENTS } from '../statutory/epf-third-schedule';
import { SOCSO_BANDS, SOCSO_WAGE_CEILING_CENTS } from '../statutory/socso-act4';
import { EIS_BANDS, EIS_WAGE_CEILING_CENTS } from '../statutory/eis-act800';
import { NON_RESIDENT_RATE_PERCENT } from '../statutory/pcb-2026';
import { HRD_LEVY_RATE_MANDATORY_PERCENT, HRD_LEVY_RATE_OPTIONAL_PERCENT } from '../statutory/hrd-levy';

/**
 * THE STATUTORY RATES, READ OUT LOUD.
 *
 * The figures have always been in `src/statutory/*` — EPF's Third Schedule,
 * SOCSO's and EIS's wage bands, the PCB constants, the HRD levy rates — and the
 * calculation reads them there. No screen ever could. The settings page said
 * "17 pay components are configured" and "rates checked", and a clinic that
 * wanted to know what Kuwick deducts had to trust it.
 *
 * This service exposes the SAME tables the calculation uses, and nothing a
 * clinic can type into: the Third Schedule says what it says.
 *
 * "CHECKED" IS A SEPARATE FACT FROM "VERIFIED".
 *
 * The registry carries a verification state per schedule — whether Kuwick's
 * transcription was checked against the authority's own document. That is
 * what the approval bar reads, and nothing here moves it. What a clinic can
 * record is that a named person here LOOKED at these tables on a date: a
 * clinic's own diligence, kept apart from Kuwick's, so neither can be mistaken
 * for the other on the screen or in an audit.
 */
const RM = (cents: number) => (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 0 });

/** The last day of the month asked for (YYYY-MM), or of this month: the day a run resolves its schedules on. */
function resolutionDayOf(period: string | undefined): Date {
  const match = period ? /^(\d{4})-(\d{2})$/.exec(period) : null;
  const year = match ? Number(match[1]) : new Date().getUTCFullYear();
  const month = match ? Number(match[2]) : new Date().getUTCMonth() + 1;
  if (!match && period) throw new BadRequestException('period must be YYYY-MM.');
  if (month < 1 || month > 12) throw new BadRequestException('period must be YYYY-MM.');
  return new Date(Date.UTC(year, month, 0));
}

@Injectable()
export class StatutorySettingsService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The name this tenant's check is filed under. One row, updated in place. */
  private static readonly CHECK_NAME = 'Clinic check of the statutory registry';

  async rates(period?: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    // RESOLVED FOR A MONTH, the way a run resolves: the last day of the month
    // asked for, or of this month. A past month shows the edition that priced
    // it, which may not be the one in force today.
    const on = resolutionDayOf(period);
    const today = on;
    const versions = await this.rawPrisma.statutoryTableVersion.findMany({ orderBy: [{ scheme: 'asc' }, { inForceFrom: 'desc' }] });
    const editions = editionsFor(on, versions);
    const stamp = (scheme: Parameters<typeof scheduleFor>[0]) => {
      const platform = editions.sources[scheme as keyof typeof editions.sources];
      if (platform && platform.origin === 'PLATFORM') {
        return {
          id: `platform:${platform.id}`,
          effectiveFrom: platform.inForceFrom,
          authority: 'Platform edition',
          document: platform.document,
          section: `Added by Kuwick for ${platform.year ?? ''}`.trim(),
          verification: 'OFFICIAL_SOURCE_VERIFIED' as const,
          verified: true,
          evidence: 'Transcribed by the platform from the source document named.',
          contentHash: platform.contentHash,
        };
      }
      const schedule = scheduleFor(scheme, today);
      return schedule
        ? {
            id: schedule.id,
            effectiveFrom: schedule.effectiveFrom.toISOString().slice(0, 10),
            authority: schedule.authority,
            document: schedule.document,
            section: schedule.section,
            verification: schedule.verification,
            verified: meetsApprovalBar(schedule.verification),
            evidence: schedule.evidence,
            contentHash: schedule.contentHash,
          }
        : null;
    };

    const check = await this.readCheck();

    return {
      period: on.toISOString().slice(0, 7),
      resolvedOn: on.toISOString().slice(0, 10),
      /** Which edition answers for each scheme on that day. */
      editions: editions.sources,
      /** Every platform-added edition, in force or not yet, for the history list. */
      versions: versions.map((row) => ({
        id: row.id,
        scheme: row.scheme,
        year: row.year,
        inForceFrom: row.inForceFrom.toISOString().slice(0, 10),
        sourceDocument: row.sourceDocument,
        sourceUrl: row.sourceUrl,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
      /** The tables themselves, band by band, as resolved for the month. */
      tables: {
        epf: {
          ceilingCents: editions.epf.ceilingCents,
          parts: editions.epf.parts.map((part) => ({ part: part.part, appliesTo: part.appliesTo, aboveCeiling: part.aboveCeiling, bands: part.bands })),
        },
        socso: { ceilingCents: editions.socso.ceilingCents, bands: editions.socso.bands },
        eis: { ceilingCents: editions.eis.ceilingCents, bands: editions.eis.bands },
        lindung: { effectiveFrom: editions.lindung.effectiveFrom.toISOString().slice(0, 10), phaseRatesPercent: editions.lindung.phaseRatesPercent },
        pcb: editions.pcb,
        hrd: editions.hrd,
      },
      epf: {
        schedule: stamp('EPF'),
        tableCeilingCents: editions.epf.ceilingCents,
        /*
         * The Schedule's parts, as the Schedule states them. A part's headline
         * rate is what applies above the table ceiling; inside the table the
         * employer's share steps at RM5,000, which the row says in words rather
         * than pretending a single percentage.
         */
        parts: editions.epf.parts.map((part) => ({
          part: part.part,
          appliesTo: part.appliesTo,
          employeePercent: part.aboveCeiling.employeePercent,
          employerPercent: part.aboveCeiling.employerPercent,
          // The band the RM5,000 step sits in, when the part has bands at all.
          employerPercentUpTo5000:
            part.bands.length > 0 ? employerPercentInBands(part.bands, 500_000) : null,
          bandCount: part.bands.length,
        })),
      },
      socso: {
        schedule: stamp('SOCSO'),
        wageCeilingCents: editions.socso.ceilingCents,
        bands: editions.socso.bands.map(([fromCents, toCents, cat1Employer, cat1Employee, cat1EmployeeNonInjury, cat2Employer, cat2EmployeeNonInjury]) => ({
          fromCents,
          toCents,
          cat1EmployerCents: cat1Employer,
          cat1EmployeeCents: cat1Employee,
          cat1EmployeeNonInjuryCents: cat1EmployeeNonInjury,
          cat2EmployerCents: cat2Employer,
          cat2EmployeeNonInjuryCents: cat2EmployeeNonInjury,
        })),
      },
      eis: {
        schedule: stamp('EIS'),
        wageCeilingCents: editions.eis.ceilingCents,
        bands: editions.eis.bands.map(([fromCents, toCents, employerCents, employeeCents]) => ({
          fromCents,
          toCents,
          employerCents,
          employeeCents,
        })),
      },
      pcb: {
        schedule: stamp('PCB'),
        nonResidentRatePercent: editions.pcb.nonResidentRatePercent,
      },
      hrd: {
        schedule: stamp('HRD_LEVY'),
        mandatoryPercent: editions.hrd.mandatoryPercent,
        optionalPercent: editions.hrd.optionalPercent,
      },
      /** The whole registry's hash, so a check can say WHAT was checked. */
      registryHash: STATUTORY_SCHEDULES.map((schedule) => schedule.contentHash).join(':'),
      wageCeilingLabel: `RM${RM(editions.socso.ceilingCents)}`,
      check,
    };
  }

  /**
   * What this clinic has recorded about looking at the registry: who, when,
   * and against which edition — so that a later registry change can be told
   * apart from a check that simply never happened.
   */
  private async readCheck() {
    const row = await this.prisma.statutoryRuleSet.findFirst({
      where: { name: StatutorySettingsService.CHECK_NAME },
      include: { verifiedBy: { select: { fullName: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row || !row.verifiedAt) return null;
    const currentHash = STATUTORY_SCHEDULES.map((schedule) => schedule.contentHash).join(':');
    return {
      checkedAt: row.verifiedAt.toISOString(),
      checkedBy: row.verifiedBy?.fullName ?? null,
      /** FALSE when the registry has changed since the clinic last looked. */
      current: row.verificationNote === currentHash,
    };
  }

  /**
   * Record that a named person here looked at the tables today.
   *
   * `hr.payroll.approve` rather than `hr.view`: the person vouching for the
   * figures is the person who would approve a run priced by them.
   */
  async markChecked() {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const tenantId = currentTenantId();
      const registryHash = STATUTORY_SCHEDULES.map((schedule) => schedule.contentHash).join(':');
      if (!registryHash) throw new BadRequestException('There is no statutory registry to check.');
      const now = new Date();
      const existing = await tx.statutoryRuleSet.findFirst({
        where: { tenantId, name: StatutorySettingsService.CHECK_NAME },
      });
      const data = {
        verificationStatus: 'VERIFIED' as const,
        verifiedAt: now,
        verifiedByStaffId: actor.id,
        verificationNote: registryHash,
        sourceUrl: 'src/statutory/registry.ts',
      };
      const saved = existing
        ? await tx.statutoryRuleSet.update({ where: { id: existing.id }, data })
        : await tx.statutoryRuleSet.create({
            data: {
              tenantId,
              name: StatutorySettingsService.CHECK_NAME,
              effectiveFrom: now,
              createdByStaffId: actor.id,
              ...data,
            },
          });
      await recordAudit(tx, actor, {
        action: 'statutory.checked',
        entityType: 'StatutoryRuleSet',
        entityId: saved.id,
        reason: `Statutory registry checked (edition ${registryHash.slice(0, 16)}…)`,
        before: existing ? { verifiedAt: existing.verifiedAt, verificationNote: existing.verificationNote } : null,
        after: { verifiedAt: saved.verifiedAt, verificationNote: saved.verificationNote },
      });
      return saved.id;
    }).then(() => this.readCheck());
  }
}

/** The employer's percentage in the band that contains `wagesCents`, or null. */
function employerPercentInBands(bands: readonly (readonly [number, number, number, number])[], wagesCents: number): number | null {
  const band = bands.find(([from, to]) => wagesCents > from && wagesCents <= to);
  if (!band) return null;
  const [, to, employerCents] = band;
  return to > 0 ? Math.round((employerCents / to) * 10000) / 100 : null;
}
