import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, resolveClinicId, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { computeAttendance, hoursOf, totalTimesheet } from './attendance-hours';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { ClockDto } from './dto/clock.dto';

function utcDay(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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

  /** The shift the roster planned for this person on this day, if any. */
  private async scheduledFor(staffId: string, day: Date) {
    const next = new Date(day.getTime() + 86400000);
    const shift = await this.prisma.providerShift.findFirst({
      where: { staffId, startsAt: { gte: day, lt: next } },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true, endsAt: true },
    });
    return shift;
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
      const day = utcDay(now);
      const clinicId = dto.clinicId ?? actor.clinicId ?? null;

      const existing = await tx.attendanceRecord.findFirst({ where: { staffId, workDate: day } });
      const shift = await this.scheduledFor(staffId, day);

      const clockInAt = existing?.clockInAt ?? now;
      const clockOutAt = existing?.clockInAt ? now : null;
      const computed = computeAttendance({
        clockInAt,
        clockOutAt,
        scheduledStart: shift?.startsAt ?? existing?.scheduledStart ?? null,
        scheduledEnd: shift?.endsAt ?? existing?.scheduledEnd ?? null,
      });

      const data = {
        clinicId,
        clockInAt,
        clockOutAt,
        scheduledStart: shift?.startsAt ?? existing?.scheduledStart ?? null,
        scheduledEnd: shift?.endsAt ?? existing?.scheduledEnd ?? null,
        status: computed.status as AttendanceStatus,
        lateMinutes: computed.lateMinutes,
        earlyOutMinutes: computed.earlyOutMinutes,
        workedMinutes: computed.workedMinutes,
        // EXCESS IS NOT OVERTIME until somebody approves it. Recorded so the
        // claim can be made; not paid until `overtimeApproved`.
        overtimeMinutes: computed.excessMinutes,
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

      const computed = computeAttendance({
        clockInAt,
        clockOutAt,
        scheduledStart: record.scheduledStart,
        scheduledEnd: record.scheduledEnd,
      });

      const updated = await tx.attendanceRecord.update({
        where: { id },
        data: {
          clockInAt,
          clockOutAt,
          status: (dto.status ?? computed.status) as AttendanceStatus,
          lateMinutes: computed.lateMinutes,
          earlyOutMinutes: computed.earlyOutMinutes,
          workedMinutes: computed.workedMinutes,
          overtimeMinutes: computed.excessMinutes,
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
        workDate: { gte: utcDay(params.from), lte: utcDay(params.to) },
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
    const day = utcDay(new Date());
    const next = new Date(day.getTime() + 86400000);

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

    const shifts = await this.prisma.providerShift.findMany({
      where: { startsAt: { gte: day, lt: next }, ...(clinicId ? { clinicId } : {}) },
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
