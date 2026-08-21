import { Inject, Injectable } from '@nestjs/common';
import { ProviderScheduleMode } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';

/**
 * §18b — THE ONE RESOLVER for "which scheduling model governs this provider
 * on this date". Everything that cares — the availability engine (and through
 * it public booking, the staff flow and reschedule), and the roster board —
 * asks HERE, so the rule exists exactly once:
 *
 *   the mode for a date is the LATEST period whose effectiveFrom is on or
 *   before it; a provider with no periods at all falls back to the legacy
 *   `Staff.appointmentScheduleMode` column.
 *
 * The fallback is not a second authority: nothing writes that column any
 * more, so it is a frozen photograph of the pre-period world, consulted only
 * until a provider's first real decision creates a period. No backfill was
 * invented — a fabricated effective date would misrepresent history — and no
 * background job exists, because a future period needs nothing to "arrive":
 * the comparison below simply starts matching it on the day.
 *
 * Dates are the clinic's calendar dates carried as UTC midnight — the same
 * `parseDateOnly` convention `AvailabilityQuery.date` and `shiftDate` use —
 * so `effectiveFrom <= date` compares like for like.
 */
@Injectable()
export class ProviderScheduleModeService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  async resolveMode(staffId: string, date: Date): Promise<ProviderScheduleMode> {
    const period = await this.prisma.providerScheduleModePeriod.findFirst({
      where: { staffId, effectiveFrom: { lte: date } },
      orderBy: { effectiveFrom: 'desc' },
      select: { mode: true },
    });
    if (period) return period.mode;

    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { appointmentScheduleMode: true },
    });
    return staff?.appointmentScheduleMode ?? ProviderScheduleMode.FIXED_WEEKLY;
  }

  /**
   * The board's batch question: every provider's mode as of one date, plus
   * EVERY change scheduled after it, in order — the whole forward plan, so
   * the rail can say "Weekly from 01 Sep" and the scheduling dialog can show
   * the timeline the owner is adding a decision to (Monthly → Weekly from
   * 1 Sep → Monthly from 1 Oct is three entries, all visible today).
   */
  async resolveModesFor(
    staffIds: string[],
    date: Date,
  ): Promise<
    Map<string, { mode: ProviderScheduleMode; upcoming: { mode: ProviderScheduleMode; effectiveFrom: Date }[] }>
  > {
    const answer = new Map<
      string,
      { mode: ProviderScheduleMode; upcoming: { mode: ProviderScheduleMode; effectiveFrom: Date }[] }
    >();
    if (staffIds.length === 0) return answer;

    const [periods, staff] = await Promise.all([
      this.prisma.providerScheduleModePeriod.findMany({
        where: { staffId: { in: staffIds } },
        orderBy: { effectiveFrom: 'asc' },
        select: { staffId: true, mode: true, effectiveFrom: true },
      }),
      this.prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, appointmentScheduleMode: true },
      }),
    ]);

    const legacy = new Map(staff.map((row) => [row.id, row.appointmentScheduleMode]));
    for (const staffId of staffIds) {
      const own = periods.filter((period) => period.staffId === staffId);
      const governing = [...own].reverse().find((period) => period.effectiveFrom <= date);
      answer.set(staffId, {
        mode: governing?.mode ?? legacy.get(staffId) ?? ProviderScheduleMode.FIXED_WEEKLY,
        upcoming: own
          .filter((period) => period.effectiveFrom > date)
          .map((period) => ({ mode: period.mode, effectiveFrom: period.effectiveFrom })),
      });
    }
    return answer;
  }
}
