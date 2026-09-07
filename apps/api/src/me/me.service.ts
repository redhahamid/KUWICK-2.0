import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceCorrectionStatus, LeaveStatus, PayrollRunStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';
import { clinicDateKey } from '../appointment/time.util';
import { AttendanceRecordService } from '../workforce/attendance-record.service';
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

    const [todayShifts, nextShift, todayRecord, openRecord, pendingLeave, upcomingLeave, pendingClaims, lastPayslipRun, corrections] =
      await Promise.all([
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
        this.prisma.attendanceRecord.findFirst({
          where: { staffId: actor.id, clockInAt: { not: null }, clockOutAt: null },
          orderBy: { workDate: 'desc' },
        }),
        this.prisma.leaveRequest.count({ where: { staffId: actor.id, status: LeaveStatus.PENDING } }),
        this.prisma.leaveRequest.findFirst({
          where: { staffId: actor.id, status: LeaveStatus.APPROVED, endDate: { gte: today } },
          orderBy: { startDate: 'asc' },
        }),
        this.prisma.staffClaim.count({
          where: { staffId: actor.id, status: { in: ['DRAFT', 'SUBMITTED'] } },
        }),
        this.prisma.payrollRun.findFirst({
          where: { status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] }, lines: { some: { staffId: actor.id } } },
          orderBy: { period: 'desc' },
          select: { id: true, period: true, status: true },
        }),
        this.prisma.attendanceCorrectionRequest.count({
          where: { staffId: actor.id, status: AttendanceCorrectionStatus.PENDING },
        }),
      ]);

    const onDuty = Boolean(openRecord);
    return {
      date: today.toISOString().slice(0, 10),
      timeZone,
      fullName: actor.fullName,
      // CLOCKED IN OR NOT is the first thing on the screen and the first thing
      // in this response, because it decides which button the page shows.
      clock: {
        onDuty,
        since: openRecord?.clockInAt ?? null,
        // Named so the phone does not have to work out whether an open record
        // from yesterday means an overnight shift or a forgotten clock-out.
        openSince: openRecord ? openRecord.workDate.toISOString().slice(0, 10) : null,
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
      latestPayslip: lastPayslipRun
        ? { runId: lastPayslipRun.id, period: lastPayslipRun.period, status: lastPayslipRun.status }
        : null,
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
    return this.attendance.clock({ staffId: actor.id, clinicId: dto.clinicId ?? actor.clinicId ?? undefined });
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
      },
    });

    return records.map((row) => ({
      id: row.id,
      workDate: row.workDate.toISOString().slice(0, 10),
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      clockInAt: row.clockInAt,
      clockOutAt: row.clockOutAt,
      status: row.status,
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
      include: { approvedBy: { select: { fullName: true } } },
    });
    return requests.map((row) => ({
      id: row.id,
      leaveType: row.leaveType,
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
      include: { attachments: { select: { id: true, fileName: true, mimeType: true, fileSize: true } } },
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
      attachments: row.attachments,
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
      if (Number(dto.amountClaimed) <= 0) throw new BadRequestException('A claim must be for more than nothing.');

      const saved = await tx.staffClaim.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId ?? actor.clinicId ?? null,
          staffId: actor.id,
          category: dto.category,
          amountClaimed: dto.amountClaimed,
          claimDate: new Date(`${dto.claimDate.slice(0, 10)}T00:00:00.000Z`),
          description: dto.description,
          status: 'SUBMITTED',
          submittedByStaffId: actor.id,
          submittedAt: new Date(),
        },
      });

      await tx.staffClaimEvent.create({
        data: {
          tenantId: currentTenantId(),
          staffClaimId: saved.id,
          actorStaffId: actor.id,
          event: 'submitted',
          detail: `${dto.category} claim for ${dto.amountClaimed} on ${dto.claimDate.slice(0, 10)}`,
          toStatus: 'SUBMITTED',
        },
      });

      await recordAudit(tx, actor, {
        action: 'staffClaim.submitted',
        entityType: 'StaffClaim',
        entityId: saved.id,
        reason: dto.description,
        after: { category: dto.category, amountClaimed: dto.amountClaimed, submittedBy: 'self' },
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
      return tx.staffClaimAttachment.create({
        data: {
          tenantId: currentTenantId(),
          staffClaimId: claim.id,
          fileName: dto.fileName,
          filePath: dto.filePath,
          mimeType: dto.mimeType,
          fileSize: dto.fileSize,
          uploadedByStaffId: actor.id,
        },
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
        payrollRun: { status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] } },
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
        payrollRun: { status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] } },
      },
      include: { payrollRun: { select: { id: true, period: true, status: true, paymentDate: true } } },
    });
    if (!line) throw new NotFoundException('No payslip of yours for that month.');
    return {
      runId: line.payrollRun.id,
      period: line.payrollRun.period,
      runStatus: line.payrollRun.status,
      paymentDate: line.payrollRun.paymentDate,
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
}
