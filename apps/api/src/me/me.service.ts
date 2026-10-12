import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceCorrectionStatus, LeaveStatus, LeaveType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';
import { clinicDateKey } from '../appointment/time.util';
import { AttendanceRecordService } from '../workforce/attendance-record.service';
import { LeaveService } from '../workforce/leave.service';
import { PayrollPayslipService } from '../workforce/payroll-payslip.service';
import { PAYSLIP_RELEASED } from '../workforce/payslip-release';
import { payDateChoicesOf, paymentsOnChosenDates } from '../workforce/pay-dates';
import { StaffFileService } from '../workforce/staff-file.service';
import { ClaimPolicyService } from '../workforce/claim-policy.service';
import { assertReceiptRule, priceClaim } from '../workforce/claim-pricing';
import { leaveDays, leaveDaysInYear } from '../workforce/leave-balance';
import { workforceCategoryOf } from '../workforce/workforce-category';
import {
  AttachReceiptDto,
  ClockSelfDto,
  RequestAttendanceCorrectionDto,
  RequestLeaveDto,
  SubmitClaimDto,
} from './dto/self-service.dto';

/**
 * MY KUWICK — everything a member of staff may see and do about THEMSELVES.
 *
 * Kuwick had no employee-facing surface at all. Seeing your own shift,
 * clocking in, asking for leave, submitting a receipt and reading your own
 * payslip were each possible only from Administration ▸ HR, which requires
 * `hr.view` and shows every colleague's data alongside your own. An ordinary
 * member of staff could not use the product.
 *
 * AUTHORISED BY IDENTITY, NOT BY A GRANT. There is deliberately no
 * `hr.self.view` permission and there will not be one: a permission is
 * something an owner can withhold, and nobody should be able to withhold
 * somebody's own attendance record from them. Every method below resolves the
 * staff member from the token and filters on that id. No method takes a
 * staffId, so there is nowhere to put somebody else's.
 *
 * WHAT IT DOES NOT DO. It never writes attendance history, never approves
 * anything, never reveals another person's pay, and never shows a payslip for
 * a run that has not been approved. An employee ASKS; a manager decides,
 * through the same services and the same audit trail as before.
 */
@Injectable()
export class MeService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly attendance: AttendanceRecordService,
    private readonly leaveService: LeaveService,
    private readonly payslipService: PayrollPayslipService,
    private readonly files: StaffFileService,
    private readonly claimPolicies: ClaimPolicyService,
  ) {}

  /** The signed-in staff member, or a refusal. Never a staffId from a caller. */
  private async me() {
    return withTenantTx(this.rawPrisma, (tx) => requireActor(tx));
  }

  private async timeZoneOf(clinicId: string | null | undefined): Promise<string> {
    if (!clinicId) return 'Asia/Kuala_Lumpur';
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
    return clinic?.timezone ?? 'Asia/Kuala_Lumpur';
  }

  private dateOnly(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  // ---------------------------------------------------------------------------
  // WHO AM I
  // ---------------------------------------------------------------------------

  /**
   * The person, their job, and their branch — never their salary.
   *
   * `EmployeeProfile` holds pay, bank details and statutory identifiers, and
   * none of that is on this response: an employee reads their pay from a
   * payslip, which is a document about one month with a total they can check,
   * not from a settings screen they might think they can edit.
   */
  async profile() {
    const actor = await this.me();
    const [employment, clinic] = await Promise.all([
      this.prisma.employeeProfile.findFirst({
        where: { staffId: actor.id },
        select: {
          employeeNo: true,
          position: true,
          department: true,
          employmentType: true,
          employmentStatus: true,
          startDate: true,
          phone: true,
          email: true,
          selfieConsentAt: true,
        },
      }),
      actor.clinicId
        ? this.prisma.clinic.findUnique({ where: { id: actor.clinicId }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);

    return {
      staffId: actor.id,
      fullName: actor.fullName,
      role: actor.role,
      category: workforceCategoryOf(actor),
      branch: clinic,
      // A staff record without an employment profile is a legitimate state —
      // an account exists before HR completes it — and the honest answer is to
      // say so rather than to render an employee card full of blanks.
      hasEmploymentProfile: Boolean(employment),
      // When the person agreed to a selfie being kept as clock-in proof.
      selfieConsentAt: employment?.selfieConsentAt?.toISOString() ?? null,
      employment: employment
        ? {
            employeeNo: employment.employeeNo,
            position: employment.position,
            department: employment.department,
            employmentType: employment.employmentType,
            employmentStatus: employment.employmentStatus,
            startDate: employment.startDate?.toISOString().slice(0, 10) ?? null,
            phone: employment.phone,
            email: employment.email,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // HOME
  // ---------------------------------------------------------------------------

  /**
   * The one screen a member of staff opens on their phone.
   *
   * Deliberately not a grid of counters. It answers, in order: am I clocked
   * in, what am I meant to be doing today, what have I got waiting on somebody
   * else, and what needs something from me.
   */
  async home() {
    const actor = await this.me();
    const timeZone = await this.timeZoneOf(actor.clinicId);
    const today = this.dateOnly(clinicDateKey(new Date(), timeZone));
    const tomorrow = new Date(today.getTime() + 86400000);
    const horizon = new Date(today.getTime() + 30 * 86400000);
    const year = today.getUTCFullYear();

    const [
      todayShifts,
      nextShift,
      todayRecord,
      openRecord,
      pendingLeave,
      upcomingLeave,
      pendingClaims,
      corrections,
      clinic,
      paidLines,
      awaitingClaims,
      decidedClaims,
      decidedLeave,
      balances,
    ] = await Promise.all([
      this.prisma.providerShift.findMany({
        where: { staffId: actor.id, shiftDate: today },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.providerShift.findFirst({
        where: { staffId: actor.id, shiftDate: { gte: tomorrow, lte: horizon } },
        orderBy: [{ shiftDate: 'asc' }, { startsAt: 'asc' }],
      }),
      this.prisma.attendanceRecord.findFirst({ where: { staffId: actor.id, workDate: today } }),
      // The overnight case: yesterday's shift may still be running.
      this.prisma.attendancePunch.findFirst({
        /*
         * STILL ON DUTY IS THE LAST PUNCH, NOT AN EMPTY CLOCK-OUT.
         *
         * This asked for a day with a clock-in and no clock-out. Once a day
         * can hold four punches, somebody who clocked out at lunch and back in
         * HAS a clock-out — the middle one — so the portal would have shown
         * them the Clock in button while they were standing at the counter,
         * and the punch would have opened a third stretch. The day's last
         * punch that counts is the only thing that answers this.
         */
        where: { staffId: actor.id, supersededAt: null },
        orderBy: { at: 'desc' },
        include: { record: { select: { workDate: true } } },
      }),
      this.prisma.leaveRequest.count({ where: { staffId: actor.id, status: LeaveStatus.PENDING } }),
      this.prisma.leaveRequest.findFirst({
        where: { staffId: actor.id, status: LeaveStatus.APPROVED, endDate: { gte: today } },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.staffClaim.count({
        where: { staffId: actor.id, status: { in: ['DRAFT', 'SUBMITTED'] } },
      }),
      this.prisma.attendanceCorrectionRequest.count({
        where: { staffId: actor.id, status: AttendanceCorrectionStatus.PENDING },
      }),
      actor.clinicId
        ? this.prisma.clinic.findUnique({ where: { id: actor.clinicId }, select: { name: true } })
        : Promise.resolve(null),
      // Months whose salary has gone out. An approved month nobody has paid
      // can still be reopened and corrected; one whose salary reached the
      // bank cannot, and that is the payslip an employee keeps (prompt §7:
      // the PDF appears at Paid; a month paid on several dates, at its salary).
      this.prisma.payrollLine.findMany({
        where: { staffId: actor.id, payrollRun: PAYSLIP_RELEASED },
        orderBy: { payrollRun: { period: 'desc' } },
        take: 3,
        select: {
          netPay: true,
          payrollRun: { select: { id: true, period: true, status: true, paymentDate: true, paidAt: true, approvedAt: true } },
        },
      }),
      this.prisma.staffClaim.findMany({
        where: { staffId: actor.id, status: 'APPROVED', payoutStatus: { in: ['PENDING', 'IN_PAYROLL'] } },
        select: { amountApproved: true, amountClaimed: true, payrollPeriod: true, paymentRoute: true },
      }),
      this.prisma.staffClaim.findMany({
        where: { staffId: actor.id, status: { in: ['APPROVED', 'REJECTED'] } },
        orderBy: { decidedAt: 'desc' },
        take: 5,
        select: { id: true, status: true, amountApproved: true, amountClaimed: true, decidedAt: true, paidAt: true, payoutStatus: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { staffId: actor.id, status: { in: [LeaveStatus.APPROVED, LeaveStatus.REJECTED] } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, leaveType: true, startDate: true, endDate: true, status: true, approvedAt: true, updatedAt: true },
      }),
      this.leaveService.balancesForSelf(actor.id, year),
    ]);

    const onDuty = openRecord?.kind === 'IN';
    const annual = balances.balances.find((row) => row.leaveType === LeaveType.ANNUAL) ?? null;
    const medical = balances.balances.find((row) => row.leaveType === LeaveType.MEDICAL) ?? null;
    const money = (value: unknown) => Number(value ?? 0);
    const awaitingTotal = awaitingClaims.reduce((sum, row) => sum + money(row.amountApproved ?? row.amountClaimed), 0);
    const awaitingPeriod =
      awaitingClaims
        .map((row) => row.payrollPeriod)
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    const paidPayslip = (line: (typeof paidLines)[number]) => ({
      runId: line.payrollRun.id,
      period: yearMonth(line.payrollRun.period),
      status: line.payrollRun.status,
      netPay: String(line.netPay),
      paymentDate: line.payrollRun.paymentDate ? dateKey(line.payrollRun.paymentDate) : null,
    });

    // WHAT HAPPENED LATELY — decisions and money, newest first. Each row links
    // to the tab where the whole story is, so the list is a door, not a log.
    const recent = [
      ...decidedClaims.map((row) => ({
        kind: 'claim' as const,
        title: `Claim RM ${money(row.amountApproved ?? row.amountClaimed).toFixed(2)}`,
        state: row.payoutStatus === 'PAID' ? 'paid' : row.status === 'APPROVED' ? 'approved' : 'not approved',
        at: row.paidAt ?? row.decidedAt,
        href: '/my/claims',
      })),
      ...paidLines.map((line) => ({
        kind: 'payslip' as const,
        title: `Payslip ${monthName(line.payrollRun.period)}`,
        state: 'ready',
        at: line.payrollRun.paymentDate ?? line.payrollRun.paidAt ?? line.payrollRun.approvedAt,
        href: '/my/payslips',
      })),
      ...decidedLeave.map((row) => ({
        kind: 'leave' as const,
        title: `Leave ${shortDate(row.startDate)}${row.endDate.getTime() !== row.startDate.getTime() ? ` to ${shortDate(row.endDate)}` : ''}`,
        state: row.status === LeaveStatus.APPROVED ? 'approved' : 'declined',
        at: row.approvedAt ?? row.updatedAt,
        href: '/my/leave',
      })),
    ]
      .filter((event): event is typeof event & { at: Date } => Boolean(event.at))
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 6)
      .map((event) => ({ ...event, at: event.at.toISOString() }));

    return {
      date: today.toISOString().slice(0, 10),
      timeZone,
      fullName: actor.fullName,
      clinicName: clinic?.name ?? null,
      // CLOCKED IN OR NOT is the first thing on the screen and the first thing
      // in this response, because it decides which button the page shows.
      clock: {
        onDuty,
        since: onDuty ? (openRecord?.at ?? null) : null,
        // Named so the phone does not have to work out whether an open record
        // from yesterday means an overnight shift or a forgotten clock-out.
        openSince: onDuty && openRecord ? openRecord.record.workDate.toISOString().slice(0, 10) : null,
        todayStatus: todayRecord?.status ?? null,
      },
      todayShifts: todayShifts.map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        shiftType: shift.shiftType,
        note: shift.note,
      })),
      nextShift: nextShift
        ? {
            date: nextShift.shiftDate.toISOString().slice(0, 10),
            startsAt: nextShift.startsAt,
            endsAt: nextShift.endsAt,
            shiftType: nextShift.shiftType,
          }
        : null,
      upcomingLeave: upcomingLeave
        ? {
            leaveType: upcomingLeave.leaveType,
            startDate: upcomingLeave.startDate.toISOString().slice(0, 10),
            endDate: upcomingLeave.endDate.toISOString().slice(0, 10),
          }
        : null,
      waiting: {
        leaveRequests: pendingLeave,
        claims: pendingClaims,
        attendanceCorrections: corrections,
      },
      latestPayslip: paidLines[0] ? paidPayslip(paidLines[0]) : null,
      payslips: paidLines.map(paidPayslip),
      leave: {
        annual: annual ? { remaining: annual.remaining, available: annual.available } : null,
        medicalUsed: medical?.taken ?? 0,
        medicalAvailable: medical?.available ?? null,
        policyName: balances.policyName,
      },
      claims: {
        awaitingTotal: awaitingTotal.toFixed(2),
        awaitingCount: awaitingClaims.length,
        payrollPeriod: awaitingPeriod ? yearMonth(awaitingPeriod) : null,
      },
      recent,
    };
  }

  // ---------------------------------------------------------------------------
  // SCHEDULE
  // ---------------------------------------------------------------------------

  /** My shifts and my approved leave over a range. Mine only, by construction. */
  async schedule(from: string, to: string) {
    const actor = await this.me();
    const start = this.dateOnly(from);
    const end = this.dateOnly(to);
    const [shifts, leave, closures] = await Promise.all([
      this.prisma.providerShift.findMany({
        where: { staffId: actor.id, shiftDate: { gte: start, lte: end } },
        orderBy: [{ shiftDate: 'asc' }, { startsAt: 'asc' }],
      }),
      this.prisma.leaveRequest.findMany({
        where: { staffId: actor.id, status: LeaveStatus.APPROVED, startDate: { lte: end }, endDate: { gte: start } },
      }),
      actor.clinicId
        ? this.prisma.clinicClosedDate.findMany({
            where: { clinicId: actor.clinicId, date: { gte: start, lte: end } },
            select: { date: true, reason: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      from,
      to,
      shifts: shifts.map((shift) => ({
        id: shift.id,
        date: shift.shiftDate.toISOString().slice(0, 10),
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        shiftType: shift.shiftType,
        note: shift.note,
      })),
      leave: leave.map((row) => ({
        leaveType: row.leaveType,
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate.toISOString().slice(0, 10),
      })),
      closures: closures.map((row) => ({ date: row.date.toISOString().slice(0, 10), reason: row.reason })),
    };
  }

  // ---------------------------------------------------------------------------
  // ATTENDANCE
  // ---------------------------------------------------------------------------

  /**
   * Clock in, or clock out.
   *
   * Delegated to the one attendance service rather than reimplemented, so the
   * clinic-local day, the roster lookup, the policy and the overnight rule are
   * the same whether a punch comes from the phone or from the front desk.
   */
  async clock(dto: ClockSelfDto) {
    const actor = await this.me();
    return this.attendance.clock({
      staffId: actor.id,
      clinicId: dto.clinicId ?? actor.clinicId ?? undefined,
      lat: dto.lat,
      lng: dto.lng,
      proofFileId: dto.proofFileId,
    });
  }

  /**
   * CONSENT TO THE SELFIE, once. Dated on the profile; a clock-in with a
   * photo is refused until it is there. The portal asks in plain words: the
   * picture is kept as proof that you were at the clinic, shown to HR, and
   * used for nothing else — no recognition, no matching.
   */
  async giveSelfieConsent() {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const profile = await tx.employeeProfile.findUnique({
        where: { staffId: actor.id },
        select: { id: true, selfieConsentAt: true },
      });
      if (!profile) {
        throw new BadRequestException('Your employment record is not complete yet. Ask HR to finish it before a selfie can be kept.');
      }
      if (profile.selfieConsentAt) return { selfieConsentAt: profile.selfieConsentAt.toISOString() };
      const updated = await tx.employeeProfile.update({
        where: { staffId: actor.id },
        data: { selfieConsentAt: new Date() },
        select: { selfieConsentAt: true },
      });
      await recordAudit(tx, actor, {
        action: 'selfieConsent.given',
        entityType: 'EmployeeProfile',
        entityId: profile.id,
        after: { selfieConsentAt: updated.selfieConsentAt },
        source: 'me.attendance',
      });
      return { selfieConsentAt: updated.selfieConsentAt?.toISOString() ?? null };
    });
  }

  /** My own attendance, with what the system made of each day. */
  async attendanceHistory(from: string, to: string) {
    const actor = await this.me();
    const records = await this.prisma.attendanceRecord.findMany({
      where: { staffId: actor.id, workDate: { gte: this.dateOnly(from), lte: this.dateOnly(to) } },
      orderBy: { workDate: 'desc' },
      include: {
        correctionRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, reason: true, decisionNote: true, createdAt: true },
        },
        // An employee sees every punch of their own day, superseded ones
        // included: "the manager changed my clock-in" is exactly the dispute
        // this record exists to settle, and it cannot settle it by hiding the
        // punch that was replaced.
        punches: {
          orderBy: { at: 'asc' },
          select: {
            id: true,
            at: true,
            kind: true,
            source: true,
            proofUrl: true,
            supersededAt: true,
            supersededReason: true,
            supersededBy: { select: { fullName: true } },
            recordedBy: { select: { fullName: true } },
          },
        },
      },
    });

    return records.map((row) => ({
      id: row.id,
      workDate: row.workDate.toISOString().slice(0, 10),
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      clockInAt: row.clockInAt,
      clockOutAt: row.clockOutAt,
      punches: row.punches.map((punch) => ({
        id: punch.id,
        at: punch.at,
        kind: punch.kind,
        source: punch.source,
        proofUrl: punch.proofUrl,
        supersededAt: punch.supersededAt,
        supersededReason: punch.supersededReason,
        supersededBy: punch.supersededBy?.fullName ?? null,
        recordedBy: punch.recordedBy?.fullName ?? null,
      })),
      status: row.status,
      source: row.source,
      proofUrl: row.proofUrl,
      clockOutProofUrl: row.clockOutProofUrl,
      outsideClinic: row.outsideClinic,
      distanceMetres: row.distanceMetres,
      lateMinutes: row.lateMinutes,
      earlyOutMinutes: row.earlyOutMinutes,
      workedMinutes: row.workedMinutes,
      // Named honestly: recorded extra time that a manager has not agreed to
      // pay is not overtime, and calling it overtime on an employee's own
      // screen is how an expectation is created that payroll then disappoints.
      extraMinutesRecorded: row.overtimeMinutes,
      overtimeApproved: row.overtimeApproved,
      corrected: row.correctedAt !== null,
      correctionRequest: row.correctionRequests[0] ?? null,
    }));
  }

  /**
   * Ask for a punch to be put right.
   *
   * An employee never writes attendance history — the person whose pay depends
   * on the number must not be the person who sets it. This records the ask; a
   * manager's decision applies it through the ordinary correction path, which
   * keeps the original punch and names the approver.
   */
  async requestCorrection(dto: RequestAttendanceCorrectionDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const record = await tx.attendanceRecord.findUnique({ where: { id: dto.attendanceRecordId } });
      if (!record) throw new NotFoundException('Attendance record not found.');
      // The ONE ownership check in this module that cannot be expressed by the
      // absence of a parameter, because the record id comes from the caller.
      if (record.staffId !== actor.id) {
        throw new ForbiddenException('You can only ask for a correction to your own attendance.');
      }
      if (!dto.requestedClockInAt && !dto.requestedClockOutAt) {
        throw new BadRequestException('Say what the punch should have been — a correction needs a time.');
      }

      const open = await tx.attendanceCorrectionRequest.findFirst({
        where: { attendanceRecordId: record.id, status: AttendanceCorrectionStatus.PENDING },
      });
      if (open) {
        throw new BadRequestException('You already have a correction waiting on this day.');
      }

      const saved = await tx.attendanceCorrectionRequest.create({
        data: {
          tenantId: currentTenantId(),
          attendanceRecordId: record.id,
          staffId: actor.id,
          requestedClockInAt: dto.requestedClockInAt ? new Date(dto.requestedClockInAt) : null,
          requestedClockOutAt: dto.requestedClockOutAt ? new Date(dto.requestedClockOutAt) : null,
          reason: dto.reason,
        },
      });

      await recordAudit(tx, actor, {
        action: 'attendanceCorrection.requested',
        entityType: 'AttendanceCorrectionRequest',
        entityId: saved.id,
        reason: dto.reason,
        after: {
          workDate: record.workDate.toISOString().slice(0, 10),
          requestedClockInAt: saved.requestedClockInAt,
          requestedClockOutAt: saved.requestedClockOutAt,
        },
        source: 'me.attendance',
      });

      return saved;
    });
  }

  /** Withdraw my own request, while nobody has decided it yet. */
  async cancelCorrection(id: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const row = await tx.attendanceCorrectionRequest.findUnique({ where: { id } });
      if (!row || row.staffId !== actor.id) throw new NotFoundException('Correction request not found.');
      if (row.status !== AttendanceCorrectionStatus.PENDING) {
        throw new BadRequestException('That request has already been decided.');
      }
      return tx.attendanceCorrectionRequest.update({
        where: { id },
        data: { status: AttendanceCorrectionStatus.CANCELLED },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // LEAVE
  // ---------------------------------------------------------------------------

  /** My leave: what is waiting, what was agreed, and what was refused. */
  async leave() {
    const actor = await this.me();
    const requests = await this.prisma.leaveRequest.findMany({
      where: { staffId: actor.id },
      orderBy: { startDate: 'desc' },
      include: {
        approvedBy: { select: { fullName: true } },
        attachments: { select: { id: true, fileName: true, mimeType: true, fileSize: true, filePath: true } },
      },
    });
    return requests.map((row) => ({
      id: row.id,
      leaveType: row.leaveType,
      attachments: row.attachments,
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate.toISOString().slice(0, 10),
      status: row.status,
      reason: row.reason,
      decidedBy: row.approvedBy?.fullName ?? null,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Ask for leave.
   *
   * Straight into the canonical `LeaveRequest` workflow — the same table a
   * manager approves from, the same rows the roster reads and payroll reads.
   * A second "self-service leave" table would be a second answer to when
   * somebody was away.
   */
  async requestLeave(dto: RequestLeaveDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const start = this.dateOnly(dto.startDate);
      const end = this.dateOnly(dto.endDate);
      if (end < start) throw new BadRequestException('Leave cannot end before it starts.');

      const clash = await tx.leaveRequest.findFirst({
        where: {
          staffId: actor.id,
          status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
      });
      if (clash) {
        throw new BadRequestException('You already have leave requested or approved over those dates.');
      }

      // WHAT THE POLICY ASKS FOR WITH THIS KIND OF LEAVE — the MC, for medical.
      const withPolicy = await tx.employeeProfile.findUnique({
        where: { staffId: actor.id },
        select: {
          leavePolicy: {
            select: { entitlements: { where: { leaveType: dto.leaveType }, select: { requiresAttachment: true } } },
          },
        },
      });
      const requiresAttachment = withPolicy?.leavePolicy?.entitlements[0]?.requiresAttachment ?? false;
      if (requiresAttachment && !dto.attachmentFileId) {
        throw new BadRequestException('This kind of leave needs the MC attached. Add it and send again.');
      }
      const attachment = dto.attachmentFileId
        ? await this.files.claimOwn(tx, actor.id, dto.attachmentFileId, 'MEDICAL_CERTIFICATE')
        : null;

      const saved = await tx.leaveRequest.create({
        data: {
          tenantId: currentTenantId(),
          staffId: actor.id,
          leaveType: dto.leaveType,
          startDate: start,
          endDate: end,
          reason: dto.halfDay ? `Half day. ${dto.reason ?? ''}`.trim() : dto.reason,
        },
      });
      if (attachment) {
        await tx.leaveRequestAttachment.create({
          data: { tenantId: currentTenantId(), leaveRequestId: saved.id, ...attachment, uploadedByStaffId: actor.id },
        });
      }

      await recordAudit(tx, actor, {
        action: 'leaveRequest.submitted',
        entityType: 'LeaveRequest',
        entityId: saved.id,
        reason: dto.reason,
        after: { leaveType: dto.leaveType, startDate: dto.startDate, endDate: dto.endDate },
        source: 'me.leave',
      });

      return saved;
    });
  }

  // ---------------------------------------------------------------------------
  // CLAIMS
  // ---------------------------------------------------------------------------

  /**
   * My claims, and where each one's money actually is.
   *
   * `paymentRoute` and `payoutStatus` are internal routing, so the employee
   * gets a plain sentence instead: nobody submitting a receipt should have to
   * learn what a payroll input entry is.
   */
  async claims() {
    const actor = await this.me();
    const rows = await this.prisma.staffClaim.findMany({
      where: { staffId: actor.id },
      orderBy: { claimDate: 'desc' },
      include: { attachments: { select: { id: true, fileName: true, mimeType: true, fileSize: true, filePath: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      claimDate: row.claimDate.toISOString().slice(0, 10),
      amountClaimed: row.amountClaimed,
      amountApproved: row.amountApproved,
      description: row.description,
      status: row.status,
      whereTheMoneyIs: this.claimPlainEnglish(row),
      payrollPeriod: row.payrollPeriod ? yearMonth(row.payrollPeriod) : null,
      distanceKm: row.distanceKm,
      mileageRate: row.mileageRate,
      attachments: row.attachments,
      submittedAt: row.submittedAt ?? row.createdAt,
      createdAt: row.createdAt,
    }));
  }

  private claimPlainEnglish(row: {
    status: string;
    paymentRoute: string | null;
    payoutStatus: string;
    payrollPeriod: Date | null;
  }): string {
    if (row.status === 'DRAFT') return 'Not sent yet.';
    if (row.status === 'SUBMITTED') return 'Waiting for your manager.';
    if (row.status === 'REJECTED') return 'Not approved.';
    if (row.status === 'CANCELLED') return 'Withdrawn.';
    if (row.payoutStatus === 'PAID') {
      return row.paymentRoute === 'PAYROLL' ? 'Paid with your salary.' : 'Reimbursed by the clinic.';
    }
    if (row.paymentRoute === 'PAYROLL') {
      const period = row.payrollPeriod ? ` in ${row.payrollPeriod.toISOString().slice(0, 7)}` : '';
      return `Approved. It will be paid with your salary${period}.`;
    }
    if (row.paymentRoute === 'FINANCE') return 'Approved. The clinic will reimburse you separately.';
    return 'Approved. Your manager has not yet said how it will be paid.';
  }

  /** Submit a claim for myself. Never for anybody else — there is no field for it. */
  async submitClaim(dto: SubmitClaimDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const profile = await tx.employeeProfile.findFirst({ where: { staffId: actor.id } });
      if (!profile) {
        throw new BadRequestException(
          'Your employment record is not complete yet, so a claim has nowhere to be paid from. Ask HR to finish your profile.',
        );
      }
      // MILEAGE IS PRICED HERE, at the clinic's rate, and the rate is frozen
      // on the claim: the kilometres are the fact and the rate on the day is
      // the price, whatever the phone showed.
      const policy = await this.claimPolicies.current();
      // The same price and the same receipt rule HR's route applies (claim-pricing.ts).
      const priced = priceClaim({ amountClaimed: dto.amountClaimed, distanceKm: dto.distanceKm }, policy);
      assertReceiptRule(policy, dto.receiptFileId);
      const mileage = priced.distanceKm !== null;
      const rate = Number(policy.mileageRatePerKm);
      const amountClaimed = priced.amountClaimed;
      const receipt = dto.receiptFileId ? await this.files.claimOwn(tx, actor.id, dto.receiptFileId, 'RECEIPT') : null;

      const saved = await tx.staffClaim.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId ?? actor.clinicId ?? null,
          staffId: actor.id,
          category: dto.category,
          amountClaimed,
          distanceKm: mileage ? (dto.distanceKm as number) : null,
          mileageRate: mileage ? rate.toFixed(2) : null,
          claimDate: new Date(`${dto.claimDate.slice(0, 10)}T00:00:00.000Z`),
          description: dto.description,
          status: 'SUBMITTED',
          submittedByStaffId: actor.id,
          submittedAt: new Date(),
        },
      });
      if (receipt) {
        await tx.staffClaimAttachment.create({
          data: { tenantId: currentTenantId(), staffClaimId: saved.id, ...receipt, uploadedByStaffId: actor.id },
        });
      }

      await tx.staffClaimEvent.create({
        data: {
          tenantId: currentTenantId(),
          staffClaimId: saved.id,
          actorStaffId: actor.id,
          event: 'submitted',
          detail: `${dto.category} claim for ${amountClaimed} on ${dto.claimDate.slice(0, 10)}${mileage ? ` (${dto.distanceKm} km at ${rate.toFixed(2)})` : ''}`,
          toStatus: 'SUBMITTED',
        },
      });

      await recordAudit(tx, actor, {
        action: 'staffClaim.submitted',
        entityType: 'StaffClaim',
        entityId: saved.id,
        reason: dto.description,
        after: { category: dto.category, amountClaimed, distanceKm: dto.distanceKm ?? null, submittedBy: 'self' },
        source: 'me.claims',
      });

      return saved;
    });
  }

  /** Attach a receipt to my own claim, while it is still mine to change. */
  async attachReceipt(claimId: string, dto: AttachReceiptDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const claim = await tx.staffClaim.findUnique({ where: { id: claimId } });
      if (!claim || claim.staffId !== actor.id) throw new NotFoundException('Claim not found.');
      if (!['DRAFT', 'SUBMITTED'].includes(claim.status)) {
        // Once a claim has been decided, its evidence is part of the decision.
        throw new BadRequestException('That claim has already been decided — its receipts cannot change.');
      }
      const meta = dto.fileId
        ? await this.files.claimOwn(tx, actor.id, dto.fileId, 'RECEIPT')
        : { fileName: dto.fileName, filePath: dto.filePath, mimeType: dto.mimeType, fileSize: dto.fileSize };
      return tx.staffClaimAttachment.create({
        data: { tenantId: currentTenantId(), staffClaimId: claim.id, ...meta, uploadedByStaffId: actor.id },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // PAYSLIPS
  // ---------------------------------------------------------------------------

  /**
   * The months I have been paid for.
   *
   * APPROVED AND PAID RUNS ONLY. A calculated run is a working draft that can
   * still change; showing it to the person being paid turns every rounding
   * correction into a conversation about why their pay went down.
   */
  async payslips() {
    const actor = await this.me();
    const lines = await this.prisma.payrollLine.findMany({
      where: {
        staffId: actor.id,
        payrollRun: PAYSLIP_RELEASED,
      },
      orderBy: { payrollRun: { period: 'desc' } },
      include: { payrollRun: { select: { id: true, period: true, status: true, paymentDate: true } } },
    });

    return lines.map((line) => ({
      runId: line.payrollRun.id,
      period: line.payrollRun.period,
      runStatus: line.payrollRun.status,
      paymentDate: line.payrollRun.paymentDate,
      grossPay: line.grossPay,
      netPay: line.netPay,
    }));
  }

  /**
   * One payslip, mine.
   *
   * The run id comes from the caller, so this is the second place ownership is
   * checked explicitly — by asking for the line belonging to BOTH that run and
   * this person, which returns nothing rather than somebody else's pay when
   * the two do not match.
   */
  async payslip(runId: string) {
    const actor = await this.me();
    const line = await this.prisma.payrollLine.findFirst({
      where: {
        payrollRunId: runId,
        staffId: actor.id,
        payrollRun: PAYSLIP_RELEASED,
      },
      include: { payrollRun: { select: { id: true, period: true, status: true, paymentDate: true, payDates: true } } },
    });
    if (!line) throw new NotFoundException('No payslip of yours for that month.');
    // WHEN IT IS PAID, from the approved record (UAT, 10 October 2026): a
    // month paid on several dates says what goes out when, and which of those
    // transfers have gone.
    const approved = await this.prisma.payrollSnapshot.findFirst({
      where: { payrollRunId: runId },
      orderBy: { version: 'desc' },
      select: { payload: true },
    });
    const mine = (approved?.payload as { employees?: { staffId: string; payments?: { date: string; netCents: number }[] }[] } | undefined)
      ?.employees?.find((employee) => employee.staffId === actor.id);
    const recorded = mine?.payments
      ? await this.prisma.payrollPaymentBatch.findMany({
          where: { payrollRunId: runId, status: 'RECORDED_PAID' },
          select: { payDate: true, paymentDate: true },
        })
      : [];
    // On the dates this run pays on: the owner may have moved a default date on the Pay step.
    const onChosenDates = mine?.payments ? paymentsOnChosenDates(mine.payments, payDateChoicesOf(line.payrollRun.payDates)) : null;
    const payments =
      onChosenDates?.map((payment) => ({
        date: payment.date,
        amountCents: payment.netCents,
        paidOn:
          recorded
            .find((batch) => batch.payDate === null || batch.payDate.toISOString().slice(0, 10) === payment.date)
            ?.paymentDate?.toISOString()
            .slice(0, 10) ?? null,
      })) ?? null;
    return {
      runId: line.payrollRun.id,
      period: line.payrollRun.period,
      runStatus: line.payrollRun.status,
      paymentDate: line.payrollRun.paymentDate,
      payments,
      staffId: actor.id,
      fullName: actor.fullName,
      // EARNINGS, then what came off, then what the employer paid on top —
      // the three questions in the order a person reads a payslip. The
      // employer's side is shown because Malaysian staff are entitled to see
      // their EPF and SOCSO credited, not because it affects what they take
      // home.
      earnings: {
        basicSalary: line.basicSalary,
        allowances: line.allowances,
        overtimePay: line.overtimePay,
        incentives: line.incentives,
        bonus: line.bonus,
        grossPay: line.grossPay,
      },
      deductions: {
        epfEmployee: line.epfEmployee,
        socsoEmployee: line.socsoEmployee,
        eisEmployee: line.eisEmployee,
        lindungEmployee: line.lindungEmployee,
        pcb: line.pcb,
        unpaidLeaveDeduction: line.unpaidLeaveDeduction,
        otherDeductions: line.otherDeductions,
      },
      employer: {
        epfEmployer: line.epfEmployer,
        socsoEmployer: line.socsoEmployer,
        eisEmployer: line.eisEmployer,
        hrdLevy: line.hrdLevy,
      },
      netPay: line.netPay,
      workedDays: line.workedDays,
      unpaidDays: line.unpaidDays,
    };
  }

  // ---------------------------------------------------------------------------
  // LEAVE — balances and a preview, for the portal's Leave tab
  // ---------------------------------------------------------------------------

  /** Balances by type for this year, and the unpaid days already taken. */
  async leaveBalances() {
    const actor = await this.me();
    const year = new Date().getUTCFullYear();
    const [row, unpaid, withPolicy] = await Promise.all([
      this.leaveService.balancesForSelf(actor.id, year),
      this.prisma.leaveRequest.findMany({
        where: {
          staffId: actor.id,
          leaveType: LeaveType.UNPAID,
          status: LeaveStatus.APPROVED,
          startDate: { lte: new Date(Date.UTC(year, 11, 31)) },
          endDate: { gte: new Date(Date.UTC(year, 0, 1)) },
        },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.employeeProfile.findUnique({
        where: { staffId: actor.id },
        select: { leavePolicy: { select: { entitlements: { select: { leaveType: true, requiresAttachment: true } } } } },
      }),
    ]);
    const needsAttachment = new Map(
      (withPolicy?.leavePolicy?.entitlements ?? []).map((row) => [row.leaveType, row.requiresAttachment] as const),
    );
    const unpaidDays = unpaid.reduce((sum, request) => sum + leaveDaysInYear(request, year), 0);
    return {
      year,
      policyName: row.policyName,
      balances: row.balances.map((balance) => ({
        leaveType: balance.leaveType,
        paid: balance.paid,
        available: balance.available,
        taken: balance.taken,
        pending: balance.pending,
        remaining: balance.remaining,
        requiresAttachment: needsAttachment.get(balance.leaveType) ?? false,
      })),
      unpaidTaken: { days: unpaidDays, lastMonth: unpaid[0] ? monthShort(unpaid[0].startDate) : null },
    };
  }

  /**
   * WHAT A REQUEST WOULD MEAN, before it is sent. Read-only.
   *
   * The days are the ones the balance engine will deduct — calendar days over
   * the range, the same `leaveDays` the balances use — so the figure shown
   * here is the figure that comes off. A half day is recorded on the request
   * (see `requestLeave`) and still counts as one day in the balance; the
   * response says so rather than pretending otherwise.
   */
  async leavePreview(query: { leaveType?: string; startDate?: string; endDate?: string; halfDay?: string }) {
    const actor = await this.me();
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (!query.startDate || !DATE.test(query.startDate) || !query.endDate || !DATE.test(query.endDate)) {
      throw new BadRequestException('Dates must be YYYY-MM-DD.');
    }
    const start = this.dateOnly(query.startDate);
    const end = this.dateOnly(query.endDate);
    if (end < start) throw new BadRequestException('Leave cannot end before it starts.');
    const leaveType = (Object.values(LeaveType) as string[]).includes(query.leaveType ?? '')
      ? (query.leaveType as LeaveType)
      : null;
    const halfDay = query.halfDay === 'true';
    const days = leaveDays({ startDate: start, endDate: end });
    const year = start.getUTCFullYear();

    const [balances, own, colleagues, holidays] = await Promise.all([
      this.leaveService.balancesForSelf(actor.id, year),
      this.prisma.leaveRequest.findFirst({
        where: {
          staffId: actor.id,
          status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          staffId: { not: actor.id },
          status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
          startDate: { lte: end },
          endDate: { gte: start },
          staff: { active: true, ...(actor.clinicId ? { clinicId: actor.clinicId } : {}) },
        },
        include: { staff: { select: { fullName: true } } },
        orderBy: { startDate: 'asc' },
        take: 5,
      }),
      this.prisma.publicHoliday.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } }),
    ]);

    const balance = leaveType ? (balances.balances.find((row) => row.leaveType === leaveType) ?? null) : null;
    return {
      days,
      halfDay,
      leaveType,
      balanceAfter: balance
        ? { remaining: balance.remaining - days, available: balance.available, overdrawn: balance.remaining - days < 0 }
        : null,
      ownClash: own ? { startDate: dateKey(own.startDate), endDate: dateKey(own.endDate), status: own.status } : null,
      clashes: colleagues.map((row) => ({
        name: row.staff.fullName,
        startDate: dateKey(row.startDate),
        endDate: dateKey(row.endDate),
        status: row.status,
        firstDay: dateKey(row.startDate > start ? row.startDate : start),
      })),
      publicHolidays: holidays.map((holiday) => ({ date: dateKey(holiday.date), name: holiday.name })),
    };
  }

  // ---------------------------------------------------------------------------
  // MEDICAL BENEFIT
  // ---------------------------------------------------------------------------

  /** This year's medical benefit account: allowance, used, left. Null when none. */
  async benefits() {
    const actor = await this.me();
    const year = new Date().getUTCFullYear();
    const account = await this.prisma.staffBenefitAccount.findFirst({
      where: { staffId: actor.id, benefitYear: year },
      include: { usages: { select: { amount: true } } },
    });
    if (!account) return { year, medical: null };
    const allowance = Number(account.allowance);
    const used = account.usages.reduce((sum, usage) => sum + Number(usage.amount), 0);
    return {
      year,
      medical: { allowance: allowance.toFixed(2), used: used.toFixed(2), remaining: Math.max(0, allowance - used).toFixed(2) },
    };
  }

  /** The mileage rate and the receipt rule, so the portal prices a journey the way the server will. */
  async claimPolicyForPortal() {
    await this.me();
    return this.claimPolicies.current();
  }

  /** The composed payslip of a PAID month, for the PDF. Identity-checked in the payslip service. */
  async payslipPdf(runId: string) {
    const actor = await this.me();
    return this.payslipService.payslipForSelf(runId, actor.id);
  }

  /** The employer's logo for a payslip the employee was just given. */
  payslipLogo(mediaId: string | null) {
    return this.payslipService.logoBytes(mediaId);
  }
}

// --- date helpers, UTC because every date-only column is stored at UTC midnight ---

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function yearMonth(value: Date): string {
  return value.toISOString().slice(0, 7);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(value: Date): string {
  return MONTHS[value.getUTCMonth()];
}

/** Three letters, always — Intl's British English writes "Sept". */
function monthShort(value: Date): string {
  return MONTHS[value.getUTCMonth()].slice(0, 3);
}

function shortDate(value: Date): string {
  return `${value.getUTCDate()} ${monthShort(value)}`;
}
