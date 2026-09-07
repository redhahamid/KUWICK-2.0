import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, resolveClinicId, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { computeAttendance, hoursOf, totalTimesheet } from './attendance-hours';
import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY, resolveAttendancePolicy } from './attendance-policy';
import { clinicDateKey } from '../appointment/time.util';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { ClockDto } from './dto/clock.dto';

/**
 * A date-only column value from a `YYYY-MM-DD` string.
 *
 * `workDate` is a Postgres DATE, which Prisma reads and writes as UTC
 * midnight. That is a STORAGE convention and says nothing about which day the
 * clinic means — deciding that is `clinicDay` below.
 */
function dateOnly(value: string): Date {
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

/**
 * THE DAY A PUNCH BELONGS TO, as the clinic reckons it.
 *
 * This was `utcDay(now)`, and in a UTC+8 country that is wrong for a third of
 * the day. A nurse clocking in at 07:00 in Kuala Lumpur is clocking in at
 * 23:00 UTC the day BEFORE, so her shift was filed against yesterday; her
 * clock-out at 15:00 local landed on today, found no open record, and opened a
 * second one with no clock-in. Both records then looked like missing punches
 * and neither had her hours. Every clinic opening before 08:00 was affected,
 * and a 23:00→07:00 night shift was affected at both ends.
 */
function clinicDay(instant: Date, timeZone: string): Date {
  return dateOnly(clinicDateKey(instant, timeZone));
}

/**
 * REAL ATTENDANCE — punches, not inferences.
 *
 * The old attendance report derived presence from `Visit.checkInAt`: a doctor
 * who saw no patients was absent by that measure, and a receptionist who never
 * sees one was permanently absent. This records what actually happened, against
 * the shift the roster planned — reading the roster, never writing to it
 * (D-090: one roster, one engine, one history).
 */
@Injectable()
export class AttendanceRecordService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The clinic's own reckoning of a calendar day. Malaysia unless told otherwise. */
  private async timeZoneOf(clinicId: string | null | undefined): Promise<string> {
    if (!clinicId) return 'Asia/Kuala_Lumpur';
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
    return clinic?.timezone ?? 'Asia/Kuala_Lumpur';
  }

  /** How this clinic measures grace, overtime and breaks. */
  private async policyFor(clinicId: string | null | undefined): Promise<AttendancePolicy> {
    const rows = await this.prisma.attendancePolicy.findMany({
      where: clinicId ? { OR: [{ clinicId }, { clinicId: null }] } : { clinicId: null },
    });
    return resolveAttendancePolicy(rows, clinicId ?? null);
  }

  /**
   * The shift the roster planned for this person on this day, if any.
   *
   * Matched on `shiftDate` — the roster's OWN clinic-local date, the day a
   * shift is read aloud and paid as. It used to be a UTC window over
   * `startsAt`, which put a Malaysian 07:00 shift in the previous day's bucket
   * and found nothing.
   *
   * The EARLIEST shift of the day, because a person clocking in once against a
   * split day is measured against the shift they turned up for.
   */
  private async scheduledFor(staffId: string, day: Date) {
    return this.prisma.providerShift.findFirst({
      where: { staffId, shiftDate: day },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true, endsAt: true },
    });
  }

  /**
   * THE RECORD AN OVERNIGHT CLOCK-OUT BELONGS TO.
   *
   * A 23:00→07:00 shift is ONE shift on the day it starts. The clock-out comes
   * on the next calendar day, and filing it there would leave the night with a
   * missing clock-out and the morning with a clock-out for a shift nobody
   * worked. So: if yesterday has an open punch whose shift was still running
   * when this one landed, this punch closes yesterday.
   *
   * Bounded by the shift's own end plus an hour of slack rather than by "was
   * it recent" — somebody who forgets to clock out on Monday and clocks in on
   * Tuesday morning must open Tuesday, not close Monday twelve hours late.
   */
  private async openOvernightRecord(staffId: string, day: Date, now: Date) {
    const yesterday = new Date(day.getTime() - 86400000);
    const open = await this.prisma.attendanceRecord.findFirst({
      where: { staffId, workDate: yesterday, clockInAt: { not: null }, clockOutAt: null },
    });
    if (!open?.scheduledEnd) return null;
    const grace = new Date(open.scheduledEnd.getTime() + 60 * 60 * 1000);
    return open.scheduledEnd > open.clockInAt! && now <= grace ? open : null;
  }

  /** Clock in, or clock out. The same endpoint, because the record decides. */
  async clock(dto: ClockDto) {
    return withAdminTx(this.rawPrisma, 'hr.view', async (tx, actor) => {
      const staffId = dto.staffId ?? actor.id;
      // Clocking somebody ELSE in is a supervisory act.
      if (staffId !== actor.id) {
        if (!actorCan(actor, 'hr.attendance.manage')) {
          throw new BadRequestException('You can only clock yourself in and out.');
        }
      }

      const now = dto.at ? new Date(dto.at) : new Date();
      const clinicId = dto.clinicId ?? actor.clinicId ?? null;
      const timeZone = await this.timeZoneOf(clinicId);
      const policy = await this.policyFor(clinicId);
      const today = clinicDay(now, timeZone);

      // An overnight shift's clock-out closes the day it STARTED on. Checked
      // before today's record, because on that morning both exist.
      const overnight = await this.openOvernightRecord(staffId, today, now);
      const day = overnight ? new Date(today.getTime() - 86400000) : today;
      const existing = overnight ?? (await tx.attendanceRecord.findFirst({ where: { staffId, workDate: day } }));
      const shift = await this.scheduledFor(staffId, day);

      const clockInAt = existing?.clockInAt ?? now;
      const clockOutAt = existing?.clockInAt ? now : null;
      const scheduledStart = shift?.startsAt ?? existing?.scheduledStart ?? null;
      const scheduledEnd = shift?.endsAt ?? existing?.scheduledEnd ?? null;
      const computed = computeAttendance({ clockInAt, clockOutAt, scheduledStart, scheduledEnd }, policy);

      const data = {
        clinicId,
        clockInAt,
        clockOutAt,
        scheduledStart,
        scheduledEnd,
        status: computed.status as AttendanceStatus,
        lateMinutes: computed.lateMinutes,
        earlyOutMinutes: computed.earlyOutMinutes,
        workedMinutes: computed.workedMinutes,
        // EXTRA TIME IS NOT OVERTIME until somebody approves it. What is stored
        // is the CANDIDATE the clinic's policy would consider — past its
        // minimum, rounded its way — because that is the number a manager
        // approves and payroll pays. The raw excess stays derivable from the
        // clock-out and the scheduled end, both of which are on this row.
        overtimeMinutes: computed.overtimeCandidateMinutes,
      };

      return existing
        ? tx.attendanceRecord.update({ where: { id: existing.id }, data })
        : tx.attendanceRecord.create({ data: { ...data, tenantId: currentTenantId(), staffId, workDate: day } });
    });
  }

  /**
   * Correct a punch. The ORIGINAL survives beside the correction.
   *
   * "The manager changed my clock-in" is exactly what an employee disputes, so
   * the record keeps both values, the actor and the reason.
   */
  async correct(id: string, dto: CorrectAttendanceDto) {
    return withAdminTx(this.rawPrisma, 'hr.attendance.manage', async (tx, actor) => {
      const record = await tx.attendanceRecord.findUnique({ where: { id } });
      if (!record) throw new NotFoundException('Attendance record not found');

      const clockInAt = dto.clockInAt ? new Date(dto.clockInAt) : record.clockInAt;
      const clockOutAt = dto.clockOutAt ? new Date(dto.clockOutAt) : record.clockOutAt;
      if (clockInAt && clockOutAt && clockOutAt < clockInAt) {
        throw new BadRequestException('Clock-out cannot be before clock-in.');
      }

      // The clinic's CURRENT policy, deliberately. A correction is a fresh
      // decision about what happened, so it is measured by the rules in force
      // when it is made; changing the policy does not silently re-measure
      // punches nobody has touched.
      const policy = await this.policyFor(record.clinicId);
      const computed = computeAttendance(
        {
          clockInAt,
          clockOutAt,
          scheduledStart: record.scheduledStart,
          scheduledEnd: record.scheduledEnd,
        },
        policy,
      );

      const updated = await tx.attendanceRecord.update({
        where: { id },
        data: {
          clockInAt,
          clockOutAt,
          status: (dto.status ?? computed.status) as AttendanceStatus,
          lateMinutes: computed.lateMinutes,
          earlyOutMinutes: computed.earlyOutMinutes,
          workedMinutes: computed.workedMinutes,
          overtimeMinutes: computed.overtimeCandidateMinutes,
          correctedAt: new Date(),
          correctedByStaffId: actor.id,
          correctionReason: dto.reason,
          // Write-once: the FIRST correction captures the original. A second
          // correction must not overwrite it with the first correction's value.
          originalClockInAt: record.originalClockInAt ?? record.clockInAt,
          originalClockOutAt: record.originalClockOutAt ?? record.clockOutAt,
        },
      });

      await recordAudit(tx, actor, {
        action: 'attendance.corrected',
        entityType: 'AttendanceRecord',
        entityId: id,
        before: { clockInAt: record.clockInAt, clockOutAt: record.clockOutAt, status: record.status },
        after: { clockInAt, clockOutAt, status: updated.status },
        reason: dto.reason,
        source: 'hr.attendance',
      });

      return updated;
    });
  }

  /** Approve an overtime claim. Separate act, separate permission. */
  async approveOvertime(id: string, minutes?: number) {
    return withAdminTx(this.rawPrisma, 'hr.attendance.manage', async (tx, actor) => {
      const record = await tx.attendanceRecord.findUnique({ where: { id } });
      if (!record) throw new NotFoundException('Attendance record not found');
      if (record.staffId === actor.id) {
        throw new BadRequestException('Overtime must be approved by somebody other than the person claiming it.');
      }

      const approved = minutes ?? record.overtimeMinutes;
      const updated = await tx.attendanceRecord.update({
        where: { id },
        data: { overtimeMinutes: approved, overtimeApproved: true, overtimeApprovedByStaffId: actor.id },
      });

      await recordAudit(tx, actor, {
        action: 'attendance.corrected',
        entityType: 'AttendanceRecord',
        entityId: id,
        before: { overtimeMinutes: record.overtimeMinutes, overtimeApproved: false },
        after: { overtimeMinutes: approved, overtimeApproved: true },
        source: 'hr.attendance.overtime',
      });
      return updated;
    });
  }

  /** A month's timesheet for one branch, with the totals payroll will read. */
  async timesheet(params: { clinicId?: string; from: string; to: string; staffId?: string }) {
    const actor = await requirePermission(this.rawPrisma, 'hr.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        ...(clinicId ? { clinicId } : {}),
        ...(params.staffId ? { staffId: params.staffId } : {}),
        workDate: { gte: dateOnly(params.from), lte: dateOnly(params.to) },
      },
      orderBy: [{ workDate: 'asc' }],
      include: { staff: { select: { id: true, fullName: true } }, clinic: { select: { name: true } } },
    });

    const byStaff = new Map<string, { name: string; rows: typeof records }>();
    for (const record of records) {
      const bucket = byStaff.get(record.staffId) ?? { name: record.staff.fullName, rows: [] as typeof records };
      bucket.rows.push(record);
      byStaff.set(record.staffId, bucket);
    }

    return {
      from: params.from,
      to: params.to,
      staff: [...byStaff.entries()].map(([staffId, bucket]) => {
        const totals = totalTimesheet(
          bucket.rows.map((row) => ({
            status: row.status,
            workedMinutes: row.workedMinutes,
            lateMinutes: row.lateMinutes,
            overtimeMinutes: row.overtimeMinutes,
            overtimeApproved: row.overtimeApproved,
          })),
        );
        return {
          staffId,
          name: bucket.name,
          ...totals,
          workedHours: hoursOf(totals.workedMinutes),
          approvedOvertimeHours: hoursOf(totals.approvedOvertimeMinutes),
          unapprovedOvertimeHours: hoursOf(totals.unapprovedOvertimeMinutes),
          days: bucket.rows.map((row) => ({
            id: row.id,
            workDate: row.workDate.toISOString().slice(0, 10),
            clockInAt: row.clockInAt,
            clockOutAt: row.clockOutAt,
            status: row.status,
            lateMinutes: row.lateMinutes,
            workedMinutes: row.workedMinutes,
            overtimeMinutes: row.overtimeMinutes,
            overtimeApproved: row.overtimeApproved,
            corrected: row.correctedAt !== null,
            correctionReason: row.correctionReason,
          })),
        };
      }),
    };
  }

  /**
   * TODAY'S BOARD — the HR module's first question: who is working, who is
   * absent, and what needs approval.
   */
  async today(clinicIdInput?: string) {
    const actor = await requirePermission(this.rawPrisma, 'hr.view');
    const clinicId = clinicIdInput ?? actor.clinicId ?? undefined;
    // TODAY AS THE CLINIC READS IT. At 07:30 in Kuala Lumpur the UTC date is
    // still yesterday, and a board that opens on yesterday tells the morning
    // shift they are not scheduled.
    const timeZone = await this.timeZoneOf(clinicId);
    const day = clinicDay(new Date(), timeZone);

    const [records, onLeave, pendingLeave, unapprovedOvertime, missingPunches] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { ...(clinicId ? { clinicId } : {}), workDate: day },
        include: { staff: { select: { id: true, fullName: true, role: true } } },
      }),
      this.prisma.leaveRequest.findMany({
        where: { status: 'APPROVED', startDate: { lte: day }, endDate: { gte: day } },
        include: { staff: { select: { id: true, fullName: true } } },
      }),
      this.prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.attendanceRecord.count({
        where: { ...(clinicId ? { clinicId } : {}), overtimeMinutes: { gt: 0 }, overtimeApproved: false },
      }),
      this.prisma.attendanceRecord.count({
        where: { ...(clinicId ? { clinicId } : {}), status: 'MISSING_PUNCH' },
      }),
    ]);

    // Matched on the roster's own date, not on a UTC window over `startsAt`.
    const shifts = await this.prisma.providerShift.findMany({
      where: { shiftDate: day, ...(clinicId ? { clinicId } : {}) },
      orderBy: { startsAt: 'asc' },
      include: { staff: { select: { id: true, fullName: true } } },
    });

    return {
      date: day.toISOString().slice(0, 10),
      clinicId: clinicId ?? null,
      onDuty: records
        .filter((row) => row.clockInAt !== null && row.clockOutAt === null)
        .map((row) => ({ staffId: row.staffId, name: row.staff.fullName, since: row.clockInAt })),
      completed: records.filter((row) => row.clockOutAt !== null).length,
      late: records.filter((row) => (row.lateMinutes ?? 0) > 0).length,
      onLeave: onLeave.map((row) => ({ staffId: row.staffId, name: row.staff.fullName, leaveType: row.leaveType })),
      scheduled: shifts.map((shift) => ({
        staffId: shift.staffId,
        name: shift.staff.fullName,
        startAt: shift.startsAt,
        endAt: shift.endsAt,
      })),
      // The three things somebody has to DO today.
      pendingLeaveApprovals: pendingLeave,
      unapprovedOvertimeClaims: unapprovedOvertime,
      missingPunches,
    };
  }
}
