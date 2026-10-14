import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceCorrectionStatus, AttendancePunchKind, AttendanceSource, AttendanceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, actorCan, requireScope, resolveClinicId, withAdminTx } from '../finance/admin-actor';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';
import { computePunchedDay, hoursOf, totalTimesheet } from './attendance-hours';
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
   * RECOMPUTE A DAY FROM ITS PUNCHES — the one place the summary is written.
   *
   * `AttendanceRecord` is no longer where a punch lives; it is what the punches
   * add up to. Every path that changes a punch ends here, so a day worked as
   * four punches and a day corrected to four punches are measured by exactly
   * the same code.
   *
   * SUPERSEDED PUNCHES ARE NOT READ. They stay on the record for the employee
   * and the audit to see, and they are not part of the arithmetic — which is
   * what "marked wrong" has to mean if it is to mean anything.
   */
  private async recomputeDay(tx: AdminTx, recordId: string) {
    const record = await tx.attendanceRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new NotFoundException('Attendance record not found');

    const punches = await tx.attendancePunch.findMany({
      where: { attendanceRecordId: recordId, supersededAt: null },
      orderBy: { at: 'asc' },
    });
    const policy = await this.policyFor(record.clinicId);
    const computed = computePunchedDay(
      {
        punches: punches.map((row) => ({ at: row.at, kind: row.kind === 'IN' ? 'IN' : 'OUT' })),
        scheduledStart: record.scheduledStart,
        scheduledEnd: record.scheduledEnd,
      },
      policy,
    );

    const firstIn = punches.find((row) => row.kind === 'IN') ?? null;
    const lastOut = [...punches].reverse().find((row) => row.kind === 'OUT') ?? null;
    /*
     * THE DAY'S FURTHEST PUNCH, still — the number the "outside clinic" chip
     * has always shown. Now it is the furthest of the punches that count,
     * rather than a running maximum a superseded punch could no longer be
     * removed from.
     */
    const distances = punches.map((row) => row.distanceMetres).filter((n): n is number => n !== null);

    return tx.attendanceRecord.update({
      where: { id: recordId },
      data: {
        clockInAt: firstIn?.at ?? null,
        clockOutAt: lastOut?.at ?? null,
        status: computed.status as AttendanceStatus,
        lateMinutes: computed.lateMinutes,
        earlyOutMinutes: computed.earlyOutMinutes,
        workedMinutes: computed.workedMinutes,
        overtimeMinutes: computed.overtimeCandidateMinutes,
        source: firstIn?.source ?? record.source,
        proofUrl: firstIn?.proofUrl ?? null,
        clockOutProofUrl: lastOut?.proofUrl ?? null,
        lat: firstIn?.lat ?? null,
        lng: firstIn?.lng ?? null,
        clockOutLat: lastOut?.lat ?? null,
        clockOutLng: lastOut?.lng ?? null,
        distanceMetres: distances.length > 0 ? Math.max(...distances) : null,
        outsideClinic: punches.some((row) => row.outsideClinic),
      },
    });
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

      const scheduledStart = shift?.startsAt ?? existing?.scheduledStart ?? null;
      const scheduledEnd = shift?.endsAt ?? existing?.scheduledEnd ?? null;

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
      /*
       * WHICH WAY THIS PUNCH GOES, from the punches themselves.
       *
       * This read `Boolean(existing?.clockInAt)` — the day already has a
       * clock-in, so this must be the clock-out — which is why a third and a
       * fourth press of the button simply moved the clock-out later and the
       * two middle punches were lost. The day now says what it is: if the last
       * punch that counts was an IN, this one closes it; otherwise it opens a
       * new stretch.
       */
      const live = existing
        ? await tx.attendancePunch.findMany({
            where: { attendanceRecordId: existing.id, supersededAt: null },
            orderBy: { at: 'asc' },
          })
        : [];
      const lastLive = live[live.length - 1] ?? null;
      const isClockOut = lastLive?.kind === 'IN';

      const record = existing
        ? await tx.attendanceRecord.update({
            where: { id: existing.id },
            data: { clinicId, scheduledStart, scheduledEnd },
          })
        : await tx.attendanceRecord.create({
            data: {
              tenantId: currentTenantId(),
              staffId,
              workDate: day,
              clinicId,
              scheduledStart,
              scheduledEnd,
              status: AttendanceStatus.MISSING_PUNCH,
              source,
            },
          });

      await tx.attendancePunch.create({
        data: {
          tenantId: currentTenantId(),
          attendanceRecordId: record.id,
          staffId,
          at: now,
          kind: isClockOut ? AttendancePunchKind.OUT : AttendancePunchKind.IN,
          source,
          proofUrl: proofPath,
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          distanceMetres: fence.distanceMetres,
          outsideClinic: fence.outside,
          // Null is the employee themselves. HR clocking somebody in is the
          // supervisory act, and the record says whose hand it was.
          recordedByStaffId: forSomebodyElse ? actor.id : null,
        },
      });

      return this.recomputeDay(tx, record.id);
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

      const live = await tx.attendancePunch.findMany({
        where: { attendanceRecordId: id, supersededAt: null },
        orderBy: { at: 'asc' },
      });

      /*
       * A CORRECTION IS PUNCHES IN AND PUNCHES OUT, NEVER AN EDIT.
       *
       * `punches` is what the Fix drawer sends: every line of the day as the
       * manager left it. An entry naming an existing punch either marks it
       * wrong or moves it; an entry naming none is a punch being added. A
       * moved punch is superseded and replaced rather than updated, so the
       * time the employee actually pressed the button survives underneath.
       *
       * Sent without `punches` — the older two-field form, and the portal's
       * own correction flow — it still means "these are the day's two ends",
       * and is translated into the same operations.
       */
      const wanted = dto.punches ?? [
        ...(dto.clockInAt ? [{ at: dto.clockInAt, kind: 'IN' as const }] : []),
        ...(dto.clockOutAt ? [{ at: dto.clockOutAt, kind: 'OUT' as const }] : []),
      ];

      const supersede = async (punchId: string) =>
        tx.attendancePunch.update({
          where: { id: punchId },
          data: { supersededAt: new Date(), supersededByStaffId: actor.id, supersededReason: dto.reason },
        });
      const add = async (at: Date, kind: AttendancePunchKind) =>
        tx.attendancePunch.create({
          data: {
            tenantId: currentTenantId(),
            attendanceRecordId: id,
            staffId: record.staffId,
            at,
            kind,
            // A punch HR recorded is MANUAL and carries no selfie and no
            // position: nobody stood anywhere to make it.
            source: AttendanceSource.MANUAL,
            recordedByStaffId: actor.id,
          },
        });

      const byId = new Map(live.map((row) => [row.id, row]));
      const touched: string[] = [];
      for (const entry of wanted) {
        const existing = entry.id ? byId.get(entry.id) : undefined;
        if (entry.id && !existing) {
          throw new BadRequestException('One of those punches is not on this day, or has already been replaced.');
        }
        if (existing) touched.push(existing.id);
        if (existing && entry.wrong) {
          await supersede(existing.id);
          continue;
        }
        if (!entry.at) continue;
        const at = new Date(entry.at);
        const kind = (entry.kind ?? existing?.kind ?? 'IN') as AttendancePunchKind;
        if (existing && existing.at.getTime() === at.getTime() && existing.kind === kind) continue;
        if (existing) await supersede(existing.id);
        await add(at, kind);
      }

      /*
       * THE TWO-FIELD FORM REPLACES THE DAY'S ENDS, not only the ones it named.
       * Sending a clock-out for a day that has one has always meant "this is
       * the clock-out", so the punch it replaces is superseded even though the
       * caller could not name it.
       */
      if (!dto.punches) {
        for (const row of live) {
          if (touched.includes(row.id)) continue;
          const replaced = wanted.some((entry) => entry.kind === row.kind);
          const isEnd = row.id === live.find((p) => p.kind === row.kind)?.id
            || row.id === [...live].reverse().find((p) => p.kind === row.kind)?.id;
          if (replaced && isEnd) await supersede(row.id);
        }
      }

      const updated = await this.recomputeDay(tx, id);
      if (updated.clockInAt && updated.clockOutAt && updated.clockOutAt < updated.clockInAt) {
        throw new BadRequestException('Clock-out cannot be before clock-in.');
      }

      const finished = await tx.attendanceRecord.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
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
        before: { punches: live.map((row) => ({ at: row.at, kind: row.kind })), status: record.status },
        after: { clockInAt: finished.clockInAt, clockOutAt: finished.clockOutAt, status: finished.status },
        reason: dto.reason,
        source: 'hr.attendance',
      });

      return finished;
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
    // The branch through the actor's SCOPE, reached through the person who
    // asked — see `timesheet()` for why not through the record.
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.attendanceCorrectionRequest.findMany({
      where: {
        status: params.status ?? AttendanceCorrectionStatus.PENDING,
        staff: scope.where(params.clinicId),
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

  /**
   * A month's timesheet for one branch, with the totals payroll will read.
   *
   * THE BRANCH COMES THROUGH THE ACTOR'S SCOPE, AND A RECORD REACHES IT
   * THROUGH THE PERSON.
   *
   * It was `params.clinicId ?? actor.clinicId`, applied to the record's own
   * `clinicId`: any account could name any branch, an account with no home
   * branch read the whole tenant by naming none, and a punch HR entered with
   * the wrong branch selected moved somebody's day onto another branch's
   * sheet. The record's branch is where the punch was stamped; the person's
   * is where they work, which is what the filter above the screen means and
   * what payroll reads when it runs a branch's month. Going through the
   * person also keeps the sheet in step with the leave and claims queues,
   * which reach their branch the same way.
   */
  async timesheet(params: { clinicId?: string; from: string; to: string; staffId?: string }) {
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        staff: scope.where(params.clinicId),
        ...(params.staffId ? { staffId: params.staffId } : {}),
        workDate: { gte: dateOnly(params.from), lte: dateOnly(params.to) },
      },
      orderBy: [{ workDate: 'asc' }],
      include: {
        staff: { select: { id: true, fullName: true } },
        clinic: { select: { name: true } },
        /*
         * EVERY PUNCH, INCLUDING THE ONES A CORRECTION REPLACED.
         *
         * The reason the clinic's admin staff press the button four times is
         * so the owner can see who left and came back late. A screen that
         * shows only the total throws that purpose away even when the
         * arithmetic underneath is right — so the day sends its punches and
         * the timesheet draws each pair.
         */
        punches: {
          orderBy: { at: 'asc' },
          select: {
            id: true,
            at: true,
            kind: true,
            source: true,
            proofUrl: true,
            outsideClinic: true,
            distanceMetres: true,
            supersededAt: true,
            supersededReason: true,
            supersededBy: { select: { fullName: true } },
            recordedBy: { select: { fullName: true } },
          },
        },
      },
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
            // The shift the punch is judged against, so a day view can show
            // "09:00–17:00" beside it without going back to the roster.
            scheduledStart: row.scheduledStart,
            scheduledEnd: row.scheduledEnd,
            status: row.status,
            lateMinutes: row.lateMinutes,
            earlyOutMinutes: row.earlyOutMinutes,
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
            punches: row.punches.map((punch) => ({
              id: punch.id,
              at: punch.at,
              kind: punch.kind,
              source: punch.source,
              proofUrl: punch.proofUrl,
              outsideClinic: punch.outsideClinic,
              distanceMetres: punch.distanceMetres,
              // A superseded punch is drawn struck through, not hidden: the
              // employee is entitled to see what was changed and by whom.
              supersededAt: punch.supersededAt,
              supersededReason: punch.supersededReason,
              supersededBy: punch.supersededBy?.fullName ?? null,
              recordedBy: punch.recordedBy?.fullName ?? null,
            })),
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
    /*
     * THE BOARD ANSWERS FOR ONE BRANCH — ALL OF IT.
     *
     * The punches were filtered by branch and the rest of the board was not:
     * everybody on leave in the tenant, every waiting leave request, every
     * submitted claim, every correction request. So an empty branch reported
     * a doctor from another branch as on leave, and the counts on the rail
     * disagreed with the queues they link to, which are scoped. Everything
     * here now reaches its branch through the PERSON, via the actor's scope —
     * a branch outside it is refused, none means the branches the account
     * holds — except the roster, whose shifts belong to a branch outright.
     */
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const clinicId = scope.assert(clinicIdInput) ?? (scope.clinicIds.length === 1 ? scope.clinicIds[0] : undefined);
    const people = { staff: scope.where(clinicIdInput) };
    // TODAY AS THE CLINIC READS IT. At 07:30 in Kuala Lumpur the UTC date is
    // still yesterday, and a board that opens on yesterday tells the morning
    // shift they are not scheduled.
    const timeZone = await this.timeZoneOf(clinicId);
    const day = clinicDay(new Date(), timeZone);

    const [records, onLeave, pendingLeave, unapprovedOvertime, missingPunches, pendingClaims, pendingCorrections] =
      await Promise.all([
        this.prisma.attendanceRecord.findMany({
          where: { ...people, workDate: day },
          include: { staff: { select: { id: true, fullName: true, role: true } } },
        }),
        this.prisma.leaveRequest.findMany({
          where: { ...people, status: 'APPROVED', startDate: { lte: day }, endDate: { gte: day } },
          include: { staff: { select: { id: true, fullName: true } } },
        }),
        this.prisma.leaveRequest.count({ where: { ...people, status: 'PENDING' } }),
        this.prisma.attendanceRecord.count({
          where: { ...people, overtimeMinutes: { gt: 0 }, overtimeApproved: false },
        }),
        this.prisma.attendanceRecord.count({
          where: { ...people, status: 'MISSING_PUNCH' },
        }),
        this.prisma.staffClaim.count({ where: { ...people, status: 'SUBMITTED' } }),
        this.prisma.attendanceCorrectionRequest.count({ where: { ...people, status: 'PENDING' } }),
      ]);

    // Matched on the roster's own date, not on a UTC window over `startsAt`.
    // ON DUTY TODAY (UAT, 14 October 2026): working and locum shifts only (an
    // OFF, LEAVE or BLOCKED row is not somebody expected at work), and
    // yesterday's overnight shifts that have not ended yet: the night doctor
    // at 03:00 is on duty today, rostered on yesterday's date.
    const now = new Date();
    const yesterday = new Date(day.getTime() - 86_400_000);
    const shifts = await this.prisma.providerShift.findMany({
      where: {
        shiftType: { in: ['WORKING', 'LOCUM'] },
        OR: [{ shiftDate: day }, { shiftDate: yesterday, endsAt: { gt: now } }],
        ...scope.where(clinicIdInput),
      },
      orderBy: { startsAt: 'asc' },
      include: {
        staff: { select: { id: true, fullName: true, role: true, professionalType: true } },
        clinic: { select: { id: true, name: true } },
        template: { select: { name: true, colour: true } },
      },
    });

    // ROSTERED, AND NOT HERE. The gap between the roster and the punches is the
    // question a manager actually walks in with, and it could not be asked
    // before: the board reported who HAD clocked in and never who had not.
    // Somebody on approved leave is not missing — they are accounted for.
    const punchedIn = new Set(records.filter((row) => row.clockInAt !== null).map((row) => row.staffId));
    // A night shift from yesterday is clocked in on yesterday's record.
    const overnight = shifts.filter((shift) => shift.shiftDate.getTime() !== day.getTime());
    const stillIn = overnight.length
      ? new Set(
          (
            await this.prisma.attendanceRecord.findMany({
              where: { workDate: yesterday, staffId: { in: overnight.map((shift) => shift.staffId) }, clockInAt: { not: null } },
              select: { staffId: true },
            })
          ).map((row) => row.staffId),
        )
      : new Set<string>();
    const away = new Set(onLeave.map((row) => row.staffId));
    const notClockedIn = shifts
      // Whether last night's shift began is yesterday's question.
      .filter((shift) => shift.shiftDate.getTime() === day.getTime())
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
        // Who, where and which shift, for the combined on-duty board.
        group: workforceCategoryOf(shift.staff) === 'DOCTOR' ? 'DOCTOR' : 'STAFF',
        clinicId: shift.clinic.id,
        clinicName: shift.clinic.name,
        shiftType: shift.shiftType,
        template: shift.template,
        night: shift.night,
        fromYesterday: shift.shiftDate.getTime() !== day.getTime(),
        clockedIn: shift.shiftDate.getTime() === day.getTime() ? punchedIn.has(shift.staffId) : stillIn.has(shift.staffId),
        onLeave: away.has(shift.staffId),
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
