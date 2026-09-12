import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceCorrectionStatus, AttendanceSource, AttendanceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, resolveClinicId, withAdminTx } from '../finance/admin-actor';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';
import { computeAttendance, hoursOf, totalTimesheet } from './attendance-hours';
import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY, resolveAttendancePolicy } from './attendance-policy';
import { clinicDateKey } from '../appointment/time.util';
import { workforceCategoryOf } from './workforce-category';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { ClockDto } from './dto/clock.dto';
import { isPlausiblePoint, judgeGeofence } from './attendance-geofence';
import { staffFilePath } from './staff-file.service';
import { DecideCorrectionDto } from './dto/decide-correction.dto';

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

  /**
   * Clock in, or clock out. The same endpoint, because the record decides.
   *
   * CLOCKING YOURSELF IN IS NOT A PERMISSIONED ACT. This required `hr.view`,
   * which is the permission to open the HR module and read everybody's hours —
   * so a nurse could not record that she had arrived, and every punch in the
   * building had to be made by somebody with administrative access. Turning up
   * for work is not administration. Any active member of staff may record
   * their own arrival and departure; clocking somebody ELSE in is the
   * supervisory act, and that still needs `hr.attendance.manage`.
   */
  async clock(dto: ClockDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const staffId = dto.staffId ?? actor.id;
      if (staffId !== actor.id) {
        if (!actorCan(actor, 'hr.attendance.manage')) {
          throw new ForbiddenException('You can only clock yourself in and out.');
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

      // WHERE THE PUNCH CAME FROM, AND WHERE IT STOOD. The portal sends the
      // phone's position and, with consent on record, a selfie already stored
      // as the person's own staff file. HR clocking somebody in is MANUAL and
      // carries neither. Outside the branch's radius the record is still
      // saved — the flag is for the manager, not a refusal.
      const forSomebodyElse = staffId !== actor.id;
      const source: AttendanceSource = forSomebodyElse ? 'MANUAL' : (dto.source ?? 'PORTAL');
      const point = isPlausiblePoint(dto.lat, dto.lng) ? { lat: dto.lat as number, lng: dto.lng as number } : null;
      const fence = judgeGeofence(point, {
        lat: policy.geofenceLat,
        lng: policy.geofenceLng,
        radiusMetres: policy.geofenceRadiusMetres,
      });
      let proofPath: string | null = null;
      if (dto.proofFileId) {
        if (forSomebodyElse) throw new BadRequestException('A selfie is the employee’s own to give.');
        const profile = await tx.employeeProfile.findUnique({ where: { staffId }, select: { selfieConsentAt: true } });
        if (!profile?.selfieConsentAt) {
          throw new BadRequestException('A selfie can be kept only after you have agreed to it. Give consent first.');
        }
        const file = await tx.staffFile.findFirst({
          where: { id: dto.proofFileId, staffId, kind: 'SELFIE' },
          select: { id: true },
        });
        if (!file) throw new NotFoundException('That selfie is not yours, or does not exist.');
        proofPath = staffFilePath(file.id);
      }
      const isClockOut = Boolean(existing?.clockInAt);
      // One distance per day: the furthest punch from the clinic, so the
      // "outside clinic" flag always has the number that earned it.
      const furthest =
        fence.distanceMetres !== null && (existing?.distanceMetres == null || fence.distanceMetres > existing.distanceMetres)
          ? fence.distanceMetres
          : (existing?.distanceMetres ?? null);
      const punchFields = isClockOut
        ? {
            clockOutLat: point?.lat ?? null,
            clockOutLng: point?.lng ?? null,
            clockOutProofUrl: proofPath,
            distanceMetres: furthest,
            outsideClinic: Boolean(existing?.outsideClinic) || fence.outside,
          }
        : {
            source,
            lat: point?.lat ?? null,
            lng: point?.lng ?? null,
            proofUrl: proofPath,
            distanceMetres: fence.distanceMetres,
            outsideClinic: fence.outside,
          };

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
        ...punchFields,
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

  /**
   * THE QUEUE OF CORRECTIONS PEOPLE HAVE ASKED FOR.
   *
   * Read with `hr.view` because seeing that a request exists is not the same
   * act as granting it, and a supervisor who can open the timesheet should be
   * able to see what is waiting on them.
   */
  async correctionRequests(params: { clinicId?: string; status?: AttendanceCorrectionStatus } = {}) {
    const actor = await requirePermission(this.rawPrisma, 'hr.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const rows = await this.prisma.attendanceCorrectionRequest.findMany({
      where: {
        status: params.status ?? AttendanceCorrectionStatus.PENDING,
        ...(clinicId ? { attendanceRecord: { clinicId } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        staff: { select: { id: true, fullName: true } },
        attendanceRecord: {
          select: {
            id: true,
            workDate: true,
            clockInAt: true,
            clockOutAt: true,
            scheduledStart: true,
            scheduledEnd: true,
            status: true,
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      staffId: row.staffId,
      staffName: row.staff.fullName,
      status: row.status,
      reason: row.reason,
      requestedClockInAt: row.requestedClockInAt,
      requestedClockOutAt: row.requestedClockOutAt,
      createdAt: row.createdAt,
      record: {
        ...row.attendanceRecord,
        workDate: row.attendanceRecord.workDate.toISOString().slice(0, 10),
      },
    }));
  }

  /**
   * Decide one. Approving APPLIES IT THROUGH `correct()`.
   *
   * Deliberately not a second write path into attendance: the original punch
   * still survives beside the new one, the approver is still named on the
   * record, and the audit trail is the one that already existed. What the
   * request adds is who asked and why, which a manager-initiated correction
   * never had.
   */
  async decideCorrection(id: string, dto: DecideCorrectionDto) {
    const request = await withAdminTx(this.rawPrisma, 'hr.attendance.manage', async (tx, actor) => {
      const row = await tx.attendanceCorrectionRequest.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Correction request not found.');
      if (row.status !== AttendanceCorrectionStatus.PENDING) {
        throw new BadRequestException('That request has already been decided.');
      }
      // A correction is somebody asking for their own hours to be changed, so
      // the same maker-checker rule as overtime applies: not your own.
      if (row.staffId === actor.id) {
        throw new BadRequestException('A correction has to be decided by somebody other than the person who asked.');
      }
      const updated = await tx.attendanceCorrectionRequest.update({
        where: { id },
        data: {
          status: dto.approve ? AttendanceCorrectionStatus.APPROVED : AttendanceCorrectionStatus.REJECTED,
          decidedByStaffId: actor.id,
          decidedAt: new Date(),
          decisionNote: dto.note ?? null,
        },
      });

      await recordAudit(tx, actor, {
        action: 'attendanceCorrection.decided',
        entityType: 'AttendanceCorrectionRequest',
        entityId: id,
        before: { status: row.status },
        after: { status: updated.status, note: dto.note ?? null },
        reason: dto.note ?? row.reason,
        source: 'hr.attendance',
      });

      return updated;
    });

    if (request.status !== AttendanceCorrectionStatus.APPROVED) return request;

    // Applied OUTSIDE the transaction above, through the one correction path,
    // so an approval cannot become a way of writing attendance that skips the
    // original-punch capture and the audit record.
    await this.correct(request.attendanceRecordId, {
      clockInAt: request.requestedClockInAt?.toISOString(),
      clockOutAt: request.requestedClockOutAt?.toISOString(),
      reason: `Correction requested by the employee: ${request.reason}`,
    });
    return request;
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
            source: row.source,
            proofUrl: row.proofUrl,
            clockOutProofUrl: row.clockOutProofUrl,
            outsideClinic: row.outsideClinic,
            distanceMetres: row.distanceMetres,
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

    const [records, onLeave, pendingLeave, unapprovedOvertime, missingPunches, pendingClaims, pendingCorrections] =
      await Promise.all([
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
        this.prisma.staffClaim.count({ where: { status: 'SUBMITTED' } }),
        this.prisma.attendanceCorrectionRequest.count({ where: { status: 'PENDING' } }),
      ]);

    // Matched on the roster's own date, not on a UTC window over `startsAt`.
    const shifts = await this.prisma.providerShift.findMany({
      where: { shiftDate: day, ...(clinicId ? { clinicId } : {}) },
      orderBy: { startsAt: 'asc' },
      include: { staff: { select: { id: true, fullName: true, role: true, professionalType: true } } },
    });

    // ROSTERED, AND NOT HERE. The gap between the roster and the punches is the
    // question a manager actually walks in with, and it could not be asked
    // before: the board reported who HAD clocked in and never who had not.
    // Somebody on approved leave is not missing — they are accounted for.
    const punchedIn = new Set(records.filter((row) => row.clockInAt !== null).map((row) => row.staffId));
    const away = new Set(onLeave.map((row) => row.staffId));
    const notClockedIn = shifts
      .filter((shift) => !punchedIn.has(shift.staffId) && !away.has(shift.staffId))
      .map((shift) => ({
        staffId: shift.staffId,
        name: shift.staff.fullName,
        dueAt: shift.startsAt,
        // Late only once the shift has actually started; at 07:00 nobody on an
        // 08:00 shift is missing, they are early.
        overdue: shift.startsAt < new Date(),
      }));

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
      notClockedIn,
      // WHO IS COVERING WHAT. Derived from the role rather than stored, the
      // same five-way split the roster is read along.
      coverage: shifts.reduce<Record<string, number>>((counts, shift) => {
        const key = workforceCategoryOf(shift.staff);
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
      // Everything somebody has to DO today, each of which the board links to.
      pendingLeaveApprovals: pendingLeave,
      unapprovedOvertimeClaims: unapprovedOvertime,
      missingPunches,
      pendingClaims,
      pendingAttendanceCorrections: pendingCorrections,
    };
  }
}
