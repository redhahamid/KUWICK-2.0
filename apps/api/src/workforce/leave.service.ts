import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, requireScope, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { computeLeaveBalance, leaveDays, proRateEntitlement } from './leave-balance';
import { UpsertLeavePolicyDto } from './dto/upsert-leave-policy.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-leave-balance.dto';
import { ImportOpeningBalancesDto } from './dto/import-opening-balances.dto';
import { LEAVE_RULES_SETTING, LeaveKind, LeaveRules, LeaveType, leaveKinds, leaveRulesOf, offeredTo, proRatesOnJoin, statutoryFloor, yearsOfServiceAt } from '../hr/leave-types';

/**
 * The three reads a balance is computed from, named so the single-person and
 * whole-clinic paths are provably passing the same shapes into one function.
 */
type LeaveProfile = {
  startDate: Date | null;
  endDate: Date | null;
  gender?: string | null;
  leavePolicy: {
    name: string;
    proRateOnJoin: boolean;
    /** Null means the policy names no cap, not that the cap is zero. */
    carryForwardDays: number | null;
    entitlements: { leaveType: LeaveType; daysPerYear: unknown; paid: boolean; requiresAttachment?: boolean }[];
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

  /** The clinic's part-year rules (`hr.leaveEntitlements`), Kuwick's where it set none. */
  private async leaveRules(): Promise<LeaveRules> {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { tenantId_key: { tenantId: currentTenantId(), key: LEAVE_RULES_SETTING } },
    });
    return leaveRulesOf(setting?.value);
  }

  async listPolicies() {
    await requirePermission(this.rawPrisma, 'hr.view');
    const policies = await this.prisma.leavePolicy.findMany({
      orderBy: { name: 'asc' },
      include: {
        entitlements: true,
        _count: { select: { employees: true } },
        notPayingAcknowledgedBy: { select: { fullName: true } },
      },
    });
    return policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      active: policy.active,
      carryForwardDays: policy.carryForwardDays,
      proRateOnJoin: policy.proRateOnJoin,
      notes: policy.notes,
      payUntakenLeaveOnExit: policy.payUntakenLeaveOnExit,
      /*
       * WHO CHOSE NOT TO PAY IT, AND WHEN. Null while the policy pays, which is
       * the default and the Act's own position. Non-null is the permanent mark
       * Settings shows: a name, a date and the reason in their words, so the
       * next person to open this screen learns it from the screen rather than
       * from a leaver asking where their money is.
       */
      notPaying: policy.payUntakenLeaveOnExit
        ? null
        : {
            reason: policy.notPayingReason,
            at: policy.notPayingAcknowledgedAt?.toISOString() ?? null,
            by: policy.notPayingAcknowledgedBy?.fullName ?? null,
          },
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

      /*
       * THE CHOICE NOT TO PAY UNTAKEN LEAVE, TAKEN BY SOMEBODY WITH A NAME.
       *
       * Section 60E(3) owes the ordinary rate of pay for every day of annual
       * leave the employee was entitled to and had not taken when the contract
       * ended — ended by EITHER party, so a resignation is covered as squarely
       * as a dismissal. Kuwick's default is to pay it, because that is what the
       * Act says.
       *
       * An employer may still choose otherwise, and Kuwick stores that choice
       * rather than refusing it — the same posture as a below-Act overtime
       * multiplier. What it will not do is let the choice be made silently: the
       * off position needs the tick and the reason together, and the answer is
       * kept against the person's name and the date.
       *
       * Switching the payout back ON clears the whole record, because there is
       * no longer a decision to hold anyone to. Leaving it off through an
       * unrelated edit — a rename, a changed entitlement — keeps the
       * acknowledgement already given, so ordinary housekeeping does not demand
       * the same conversation twice.
       */
      const paying = dto.payUntakenLeaveOnExit ?? existing?.payUntakenLeaveOnExit ?? true;
      const alreadyWithheld = existing !== null && !existing.payUntakenLeaveOnExit;
      const withholding = (() => {
        if (paying) {
          return { payUntakenLeaveOnExit: true, notPayingReason: null, notPayingAcknowledgedAt: null, notPayingAcknowledgedByStaffId: null };
        }
        if (alreadyWithheld) {
          return {
            payUntakenLeaveOnExit: false,
            notPayingReason: existing.notPayingReason,
            notPayingAcknowledgedAt: existing.notPayingAcknowledgedAt,
            notPayingAcknowledgedByStaffId: existing.notPayingAcknowledgedByStaffId,
          };
        }
        const reason = (dto.notPayingReason ?? '').trim();
        if (!dto.notPayingAcknowledged || reason.length < 4) {
          throw new BadRequestException(
            'Section 60E(3) of the Employment Act requires untaken annual leave to be paid at the ordinary rate of pay ' +
              'when the contract of service ends, whichever party ends it — a resignation as much as a dismissal. ' +
              'Turning the payout off means this clinic is choosing not to meet that obligation. That is yours to ' +
              'decide, and Kuwick will store it — but not silently. Confirm that this is deliberate and say why, and ' +
              'the choice is recorded against your name and today\u2019s date.',
          );
        }
        return {
          payUntakenLeaveOnExit: false,
          notPayingReason: reason,
          notPayingAcknowledgedAt: new Date(),
          notPayingAcknowledgedByStaffId: actor.id,
        };
      })();

      const policy = existing
        ? await tx.leavePolicy.update({
            where: { id: existing.id },
            data: {
              name: dto.name,
              carryForwardDays: dto.carryForwardDays,
              proRateOnJoin: dto.proRateOnJoin,
              notes: dto.notes,
              active: dto.active ?? existing.active,
              ...withholding,
            },
          })
        : await tx.leavePolicy.create({
            data: {
              tenantId: currentTenantId(),
              name: dto.name,
              carryForwardDays: dto.carryForwardDays,
              proRateOnJoin: dto.proRateOnJoin ?? true,
              notes: dto.notes,
              ...withholding,
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
        after: {
          name: policy.name,
          entitlements: dto.entitlements?.length ?? 0,
          payUntakenLeaveOnExit: policy.payUntakenLeaveOnExit,
          ...(policy.payUntakenLeaveOnExit ? {} : { notPayingReason: policy.notPayingReason }),
        },
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
    const kinds = leaveKinds(await this.prisma.leaveTypeSetting.findMany({ orderBy: { sortOrder: 'asc' } }));

    return this.balanceRow({ staffId, year, profile, stored, requests, kinds, rules: await this.leaveRules() });
  }

  /**
   * THE SAME ROW FOR THE PERSON THEMSELVES — no HR permission, because the
   * caller (the portal) has already established that `staffId` is the actor.
   * One computation behind two doors: the figure an employee sees can never
   * disagree with the one HR sees on their record.
   */
  async balancesForSelf(staffId: string, year = new Date().getUTCFullYear()) {
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
    const kinds = leaveKinds(await this.prisma.leaveTypeSetting.findMany({ orderBy: { sortOrder: 'asc' } }));

    return this.balanceRow({ staffId, year, profile, stored, requests, kinds, rules: await this.leaveRules() });
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
    kinds,
    rules,
  }: {
    staffId: string;
    year: number;
    profile: LeaveProfile | null;
    stored: StoredBalance[];
    requests: LeaveRequestRow[];
    kinds: LeaveKind[];
    rules: LeaveRules;
  }) {
    const storedByType = new Map(stored.map((row) => [row.leaveType, row]));
    const kindOf = new Map(kinds.map((kind) => [kind.code, kind]));
    // THE CLINIC'S LEAVE TYPES (Section D): a person with a policy has the
    // policy's types; without one, every active type with yearly days. Any
    // type they have a stored row or a request for is shown too.
    // Somebody with no HR record at all (the owner's own login) is entitled
    // to nothing until HR makes one (new-clinic UAT #2, item 53).
    const listed = !profile
      ? []
      : profile.leavePolicy
        ? profile.leavePolicy.entitlements.map((entitlement) => entitlement.leaveType)
        : kinds.filter((kind) => kind.active && kind.daysPerYear !== null).map((kind) => kind.code);
    // Maternity for women, paternity for men (item 79): a type kept only by a
    // stored row or a request still shows, because those days are real.
    const offered = listed.filter((code) => offeredTo(kindOf.get(code)?.statutory, profile?.gender));
    const types: LeaveType[] = [...new Set([...offered, ...stored.map((row) => row.leaveType), ...requests.map((row) => row.leaveType)])];
    const years = yearsOfServiceAt(profile?.startDate, year);

    return {
      staffId,
      year,
      policyName: profile?.leavePolicy?.name ?? null,
      /*
       * THE CARRY-FORWARD CAP, on the screen for the first time.
       *
       * The policy has carried this number since leave shipped and nothing has
       * ever read it — not the balance, not a rollover (there is none), not the
       * adjustment that is the only way days get carried in. A cap nobody can
       * see is a cap nobody can be held to, which is why it goes out with the
       * balances rather than waiting for a policy editor that does not exist.
       */
      carryForwardCap: profile?.leavePolicy?.carryForwardDays ?? kindOf.get(LeaveType.ANNUAL)?.carryForwardCap ?? null,
      // A person with no policy is reported as such, not silently given zero:
      // "nobody has assigned a leave policy" is a piece of HR work.
      policyAssigned: Boolean(profile?.leavePolicy),
      /** False for an account with no employment record: it has no leave to show. */
      hasHrRecord: Boolean(profile),
      balances: types.map((leaveType) => {
        const entitlement = profile?.leavePolicy?.entitlements.find((row) => row.leaveType === leaveType);
        const kind = kindOf.get(leaveType);
        const storedRow = storedByType.get(leaveType);
        // The policy's days, else the type's; never below the Act for a statutory type (decision 6).
        const fullYear = Math.max(Number(entitlement?.daysPerYear ?? kind?.daysPerYear ?? 0), statutoryFloor(kind?.statutory, years));
        // The clinic's own list of types given in full (item 80), then the Act's.
        const proRate =
          (profile?.leavePolicy ? profile.leavePolicy.proRateOnJoin : true) &&
          proRatesOnJoin(kind?.statutory) &&
          !rules.notProRated.includes(leaveType);
        const fixed = storedRow?.entitledDays !== null && storedRow?.entitledDays !== undefined;
        const entitled = fixed
          ? Number(storedRow!.entitledDays)
          : proRate && profile
            ? proRateEntitlement(fullYear, year, profile.startDate, profile.endDate, rules.rounding === 'WHOLE' ? 1 : 0.5)
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
          name: kind?.name ?? leaveType,
          paid: entitlement?.paid ?? kind?.paid ?? true,
          documentRequired: entitlement?.requiresAttachment ?? kind?.documentRequired ?? false,
          carryForwardCap: kind?.carryForwardCap ?? null,
          actMinimum: kind?.statutory ? statutoryFloor(kind.statutory, years) : null,
          proRated: !fixed && proRate,
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
    // The branch through the actor's scope: one outside it is refused, none
    // means the branches the account holds — never the whole tenant.
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const year = params.year ?? new Date().getUTCFullYear();

    const profiles = await this.prisma.employeeProfile.findMany({
      where: {
        staff: {
          active: true,
          ...scope.where(params.clinicId),
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

    const kinds = leaveKinds(await this.prisma.leaveTypeSetting.findMany({ orderBy: { sortOrder: 'asc' } }));
    const rules = await this.leaveRules();
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
            kinds,
            rules,
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

      /*
       * THE CARRY-FORWARD CAP, ENFORCED — the only place it can be.
       *
       * `carryForwardDays` says how many unused annual days a clinic lets cross
       * into the next year. It has never been read by anything: there is no
       * year-end rollover job in this API, so the ONLY way a day is carried in
       * is somebody typing it here. A cap that the one writer ignores is not a
       * policy, it is a note.
       *
       * Section D (14 October 2026): the cap is the leave type's own setting;
       * for annual leave the person's policy cap applies where the type has
       * none. No cap recorded refuses nothing.
       */
      if (dto.carriedInDays !== undefined) {
        await refuseOverCarryCap(tx, dto.staffId, dto.leaveType, dto.carriedInDays);
      }
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
              // Null leaves the entitlement to the leave type or policy.
              entitledDays: dto.entitledDays ?? null,
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
   * OPENING BALANCES (Section D): leave already taken this year before the
   * clinic started on Kuwick, and days carried in, from a CSV. Matched by
   * Employee No. All or nothing: one bad line and nothing is written, and
   * every problem is listed by line.
   */
  async importOpeningBalances(dto: ImportOpeningBalancesDto) {
    return withAdminTx(this.rawPrisma, 'hr.leave.approve', async (tx, actor) => {
      const kinds = leaveKinds(await tx.leaveTypeSetting.findMany());
      const codes = new Set(kinds.map((kind) => kind.code));
      const profiles = await tx.employeeProfile.findMany({
        where: { employeeNo: { in: dto.rows.map((row) => row.employeeNo.trim()) } },
        select: { staffId: true, employeeNo: true },
      });
      const staffOf = new Map(profiles.map((row) => [row.employeeNo, row.staffId]));
      const problems: { line: number; message: string }[] = [];
      dto.rows.forEach((row, index) => {
        const line = index + 2; // the header is line 1
        if (!staffOf.has(row.employeeNo.trim())) problems.push({ line, message: `No employee with Employee No. ${row.employeeNo}.` });
        if (!codes.has(row.leaveType)) problems.push({ line, message: `${row.leaveType} is not one of the clinic's leave types.` });
      });
      for (const [index, row] of dto.rows.entries()) {
        const staffId = staffOf.get(row.employeeNo.trim());
        if (!staffId || row.carriedInDays === undefined) continue;
        try {
          await refuseOverCarryCap(tx, staffId, row.leaveType, row.carriedInDays);
        } catch (error) {
          problems.push({ line: index + 2, message: (error as Error).message });
        }
      }
      if (problems.length > 0) return { imported: 0, problems };

      for (const row of dto.rows) {
        const staffId = staffOf.get(row.employeeNo.trim())!;
        const key = { staffId, leaveType: row.leaveType, benefitYear: dto.year };
        const existing = await tx.leaveBalance.findFirst({ where: key });
        const data = {
          adjustmentDays: -row.takenDays,
          adjustmentReason: 'Taken before Kuwick (opening balance)',
          ...(row.carriedInDays === undefined ? {} : { carriedInDays: row.carriedInDays }),
        };
        if (existing) await tx.leaveBalance.update({ where: { id: existing.id }, data });
        else await tx.leaveBalance.create({ data: { ...key, ...data, tenantId: currentTenantId() } });
      }
      await recordAudit(tx, actor, {
        action: 'leave.openingBalancesImported',
        entityType: 'LeaveBalance',
        entityId: `year-${dto.year}`,
        after: { year: dto.year, rows: dto.rows.length },
        source: 'hr.leaveBalances',
      });
      return { imported: dto.rows.length, problems };
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

/** Carried-in days may not pass the leave type's cap, or for annual leave the person's policy cap. */
async function refuseOverCarryCap(tx: AdminTx, staffId: string, leaveType: string, carriedInDays: number) {
  const [kind, profile] = await Promise.all([
    tx.leaveTypeSetting.findFirst({ where: { code: leaveType }, select: { name: true, carryForwardCap: true } }),
    tx.employeeProfile.findFirst({ where: { staffId }, select: { leavePolicy: { select: { name: true, carryForwardDays: true } } } }),
  ]);
  const typeCap = kind?.carryForwardCap === null || kind?.carryForwardCap === undefined ? null : Number(kind.carryForwardCap);
  const policyCap = leaveType === LeaveType.ANNUAL ? (profile?.leavePolicy?.carryForwardDays ?? null) : null;
  const cap = typeCap ?? policyCap;
  if (cap !== null && carriedInDays > cap) {
    const whose = typeCap !== null ? (kind?.name ?? leaveType) : `${profile?.leavePolicy?.name ?? 'This leave policy'}'s annual leave`;
    throw new BadRequestException(
      `${whose} carries forward at most ${cap} ${cap === 1 ? 'day' : 'days'}, and ${carriedInDays} was entered. ` +
        'Raise the cap first if the clinic has decided to allow more.',
    );
  }
}
