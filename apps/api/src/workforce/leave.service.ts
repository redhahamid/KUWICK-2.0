import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { computeLeaveBalance, leaveDays, proRateEntitlement } from './leave-balance';
import { UpsertLeavePolicyDto } from './dto/upsert-leave-policy.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-leave-balance.dto';

/**
 * The three reads a balance is computed from, named so the single-person and
 * whole-clinic paths are provably passing the same shapes into one function.
 */
type LeaveProfile = {
  startDate: Date | null;
  endDate: Date | null;
  leavePolicy: {
    name: string;
    proRateOnJoin: boolean;
    entitlements: { leaveType: LeaveType; daysPerYear: unknown; paid: boolean }[];
  } | null;
};
type StoredBalance = {
  leaveType: LeaveType;
  entitledDays: unknown;
  carriedInDays: unknown;
  adjustmentDays: unknown;
  adjustmentReason: string | null;
};
type LeaveRequestRow = { leaveType: LeaveType; startDate: Date; endDate: Date; status: string };

/**
 * LEAVE — policies, entitlements and balances.
 *
 * `LeaveRequest` itself stays where it is (`hr/leave-request.service.ts`,
 * Phase 1c): applications, approvals and rejections already work and already
 * feed the roster. What was missing was the ENTITLEMENT side — how many days
 * somebody has, how many they have used, and what happens at year end.
 *
 * BALANCES ARE DERIVED. `taken` is always computed from approved requests, so
 * a cancelled leave returns its days automatically and a balance can never
 * disagree with the requests behind it.
 */
@Injectable()
export class LeaveService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async listPolicies() {
    await requirePermission(this.rawPrisma, 'hr.view');
    const policies = await this.prisma.leavePolicy.findMany({
      orderBy: { name: 'asc' },
      include: { entitlements: true, _count: { select: { employees: true } } },
    });
    return policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      active: policy.active,
      carryForwardDays: policy.carryForwardDays,
      proRateOnJoin: policy.proRateOnJoin,
      notes: policy.notes,
      employees: policy._count.employees,
      entitlements: policy.entitlements.map((entitlement) => ({
        leaveType: entitlement.leaveType,
        daysPerYear: Number(entitlement.daysPerYear),
        paid: entitlement.paid,
        requiresAttachment: entitlement.requiresAttachment,
      })),
    }));
  }

  async upsertPolicy(dto: UpsertLeavePolicyDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const existing = dto.id ? await tx.leavePolicy.findUnique({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Leave policy not found');

      const policy = existing
        ? await tx.leavePolicy.update({
            where: { id: existing.id },
            data: {
              name: dto.name,
              carryForwardDays: dto.carryForwardDays,
              proRateOnJoin: dto.proRateOnJoin,
              notes: dto.notes,
              active: dto.active ?? existing.active,
            },
          })
        : await tx.leavePolicy.create({
            data: {
              tenantId: currentTenantId(),
              name: dto.name,
              carryForwardDays: dto.carryForwardDays,
              proRateOnJoin: dto.proRateOnJoin ?? true,
              notes: dto.notes,
            },
          });

      if (dto.entitlements) {
        for (const entitlement of dto.entitlements) {
          await tx.leavePolicyEntitlement.upsert({
            where: { leavePolicyId_leaveType: { leavePolicyId: policy.id, leaveType: entitlement.leaveType } },
            create: {
              tenantId: currentTenantId(),
              leavePolicyId: policy.id,
              leaveType: entitlement.leaveType,
              daysPerYear: entitlement.daysPerYear,
              paid: entitlement.paid ?? true,
              requiresAttachment: entitlement.requiresAttachment ?? false,
            },
            update: {
              daysPerYear: entitlement.daysPerYear,
              paid: entitlement.paid ?? true,
              requiresAttachment: entitlement.requiresAttachment ?? false,
            },
          });
        }
      }

      await recordAudit(tx, actor, {
        action: 'employee.changed',
        entityType: 'LeavePolicy',
        entityId: policy.id,
        after: { name: policy.name, entitlements: dto.entitlements?.length ?? 0 },
        source: 'hr.leavePolicies',
      });
      return policy;
    });
  }

  /**
   * One person's balances for a year, every type they are entitled to.
   *
   * The entitlement comes from their policy, pro-rated if they joined or left
   * mid-year and the policy says to. A stored `LeaveBalance` row overrides the
   * policy figure — that is what the row is FOR: a negotiated entitlement, a
   * carried-forward amount, or a manual correction.
   */
  async balancesFor(staffId: string, year = new Date().getUTCFullYear()) {
    await requirePermission(this.rawPrisma, 'hr.view');

    const [profile, stored, requests] = await Promise.all([
      this.prisma.employeeProfile.findUnique({
        where: { staffId },
        include: { leavePolicy: { include: { entitlements: true } } },
      }),
      this.prisma.leaveBalance.findMany({ where: { staffId, benefitYear: year } }),
      this.prisma.leaveRequest.findMany({
        where: {
          staffId,
          startDate: { lte: new Date(Date.UTC(year, 11, 31)) },
          endDate: { gte: new Date(Date.UTC(year, 0, 1)) },
        },
      }),
    ]);

    return this.balanceRow({ staffId, year, profile, stored, requests });
  }

  /**
   * ONE PERSON'S BALANCES, from facts already read.
   *
   * Split out of `balancesFor` so the whole-clinic read below computes each
   * person the same way rather than growing a second entitlement rule. The
   * only difference between the two callers is where the three inputs came
   * from — one query each, or one query for everybody.
   */
  private balanceRow({
    staffId,
    year,
    profile,
    stored,
    requests,
  }: {
    staffId: string;
    year: number;
    profile: LeaveProfile | null;
    stored: StoredBalance[];
    requests: LeaveRequestRow[];
  }) {
    const storedByType = new Map(stored.map((row) => [row.leaveType, row]));
    const types: LeaveType[] = profile?.leavePolicy?.entitlements.map((entitlement) => entitlement.leaveType) ?? [
      ...new Set([...stored.map((row) => row.leaveType), ...requests.map((row) => row.leaveType)]),
    ];

    return {
      staffId,
      year,
      policyName: profile?.leavePolicy?.name ?? null,
      // A person with no policy is reported as such, not silently given zero:
      // "nobody has assigned a leave policy" is a piece of HR work.
      policyAssigned: Boolean(profile?.leavePolicy),
      balances: types.map((leaveType) => {
        const entitlement = profile?.leavePolicy?.entitlements.find((row) => row.leaveType === leaveType);
        const storedRow = storedByType.get(leaveType);
        const fullYear = Number(entitlement?.daysPerYear ?? 0);
        const entitled =
          storedRow !== undefined
            ? Number(storedRow.entitledDays)
            : profile?.leavePolicy?.proRateOnJoin
              ? proRateEntitlement(fullYear, year, profile.startDate, profile.endDate)
              : fullYear;

        const balance = computeLeaveBalance({
          entitledDays: entitled,
          carriedInDays: Number(storedRow?.carriedInDays ?? 0),
          adjustmentDays: Number(storedRow?.adjustmentDays ?? 0),
          year,
          requests: requests
            .filter((row) => row.leaveType === leaveType)
            .map((row) => ({
              startDate: row.startDate,
              endDate: row.endDate,
              status: row.status as 'PENDING' | 'APPROVED' | 'REJECTED',
            })),
        });

        return {
          leaveType,
          paid: entitlement?.paid ?? true,
          proRated: storedRow === undefined && Boolean(profile?.leavePolicy?.proRateOnJoin),
          fullYearEntitlement: fullYear,
          ...balance,
          adjustmentReason: storedRow?.adjustmentReason ?? null,
        };
      }),
    };
  }

  /**
   * EVERYBODY'S BALANCES, for the Leave screen's Balances view.
   *
   * The alternative was the web calling `balancesFor` once per employee, which
   * is a permission check and three queries per person for a screen that shows
   * a table. This reads the same three things once and runs the SAME row
   * computation over them, so a figure here can never disagree with the one on
   * somebody's own record.
   *
   * Read-only, `hr.view`, and it invents no entitlement rule of its own.
   */
  async balancesForEveryone(params: { clinicId?: string; year?: number } = {}) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const year = params.year ?? new Date().getUTCFullYear();

    const profiles = await this.prisma.employeeProfile.findMany({
      where: {
        staff: {
          active: true,
          ...(params.clinicId ? { clinicId: params.clinicId } : {}),
        },
      },
      include: {
        leavePolicy: { include: { entitlements: true } },
        staff: { select: { id: true, fullName: true } },
      },
    });
    const staffIds = profiles.map((profile) => profile.staffId);
    if (staffIds.length === 0) return { year, employees: [] };

    const [stored, requests] = await Promise.all([
      this.prisma.leaveBalance.findMany({ where: { staffId: { in: staffIds }, benefitYear: year } }),
      this.prisma.leaveRequest.findMany({
        where: {
          staffId: { in: staffIds },
          startDate: { lte: new Date(Date.UTC(year, 11, 31)) },
          endDate: { gte: new Date(Date.UTC(year, 0, 1)) },
        },
      }),
    ]);

    const storedByStaff = new Map<string, StoredBalance[]>();
    for (const row of stored) storedByStaff.set(row.staffId, [...(storedByStaff.get(row.staffId) ?? []), row]);
    const requestsByStaff = new Map<string, LeaveRequestRow[]>();
    for (const row of requests) requestsByStaff.set(row.staffId, [...(requestsByStaff.get(row.staffId) ?? []), row]);

    return {
      year,
      employees: profiles
        .map((profile) => ({
          name: profile.staff.fullName,
          ...this.balanceRow({
            staffId: profile.staffId,
            year,
            profile,
            stored: storedByStaff.get(profile.staffId) ?? [],
            requests: requestsByStaff.get(profile.staffId) ?? [],
          }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** A manual correction to somebody's entitlement, with a reason. */
  async adjustBalance(dto: AdjustLeaveBalanceDto) {
    return withAdminTx(this.rawPrisma, 'hr.leave.approve', async (tx, actor) => {
      const existing = await tx.leaveBalance.findFirst({
        where: { staffId: dto.staffId, leaveType: dto.leaveType, benefitYear: dto.benefitYear },
      });

      const saved = existing
        ? await tx.leaveBalance.update({
            where: { id: existing.id },
            data: {
              entitledDays: dto.entitledDays ?? existing.entitledDays,
              carriedInDays: dto.carriedInDays ?? existing.carriedInDays,
              adjustmentDays: dto.adjustmentDays ?? existing.adjustmentDays,
              adjustmentReason: dto.reason,
            },
          })
        : await tx.leaveBalance.create({
            data: {
              tenantId: currentTenantId(),
              staffId: dto.staffId,
              leaveType: dto.leaveType,
              benefitYear: dto.benefitYear,
              entitledDays: dto.entitledDays ?? 0,
              carriedInDays: dto.carriedInDays ?? 0,
              adjustmentDays: dto.adjustmentDays ?? 0,
              adjustmentReason: dto.reason,
            },
          });

      await recordAudit(tx, actor, {
        action: 'leave.decided',
        entityType: 'LeaveBalance',
        entityId: saved.id,
        before: existing
          ? { entitledDays: String(existing.entitledDays), adjustmentDays: String(existing.adjustmentDays) }
          : null,
        after: {
          staffId: dto.staffId,
          leaveType: dto.leaveType,
          benefitYear: dto.benefitYear,
          entitledDays: dto.entitledDays,
          adjustmentDays: dto.adjustmentDays,
        },
        reason: dto.reason,
        source: 'hr.leaveBalances',
      });
      return saved;
    });
  }

  /**
   * Whether somebody has the days for a request. Called before approval so a
   * manager sees the consequence before they cause it.
   */
  async checkAvailability(staffId: string, leaveType: LeaveType, startDate: string, endDate: string) {
    const days = leaveDays({ startDate, endDate });
    const year = new Date(`${startDate}T00:00:00.000Z`).getUTCFullYear();
    const balances = await this.balancesFor(staffId, year);
    const balance = balances.balances.find((row) => row.leaveType === leaveType);
    if (!balance) {
      throw new BadRequestException('This staff member has no entitlement configured for that leave type.');
    }
    return {
      requestedDays: days,
      remaining: balance.remaining,
      wouldRemain: balance.remaining - days,
      // A clinic may allow it and take it as unpaid; the system's job is to
      // make sure nobody approves it without knowing.
      exceedsEntitlement: balance.remaining - days < 0,
      paid: balance.paid,
    };
  }
}
