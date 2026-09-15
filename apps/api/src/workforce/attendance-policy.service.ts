import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requireScope, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY, resolveAttendancePolicy } from './attendance-policy';
import { SaveAttendancePolicyDto } from './dto/save-attendance-policy.dto';

/**
 * READ AND WRITE THE CLINIC'S ATTENDANCE RULES.
 *
 * Reading is `hr.view`, because every screen that shows a late arrival has to
 * be able to say what "late" means here. Writing is `hr.attendance.manage` —
 * the same permission that corrects a punch, because moving the grace period
 * changes what yesterday's punches will be judged by tomorrow.
 */
@Injectable()
export class AttendancePolicyService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * What this clinic measures by, and where each rule came from.
   *
   * `source` is on the response because "why is 09:06 late here and not at the
   * other branch" is the first question anybody asks, and the answer is either
   * this clinic's row, the group's default, or the built-in.
   */
  async effective(clinicIdInput?: string) {
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const clinicId = scope.assert(clinicIdInput) ?? null;
    const rows = await this.prisma.attendancePolicy.findMany({
      where: clinicId ? { OR: [{ clinicId }, { clinicId: null }] } : {},
      include: { clinic: { select: { name: true } } },
    });
    const policy = resolveAttendancePolicy(rows, clinicId);
    const own = rows.find((row) => row.clinicId === clinicId && clinicId !== null);
    const groupDefault = rows.find((row) => row.clinicId === null);
    return {
      clinicId,
      policy,
      source: own ? 'CLINIC' : groupDefault ? 'GROUP_DEFAULT' : 'KUWICK_DEFAULT',
      defaults: DEFAULT_ATTENDANCE_POLICY,
      hasOwnPolicy: Boolean(own),
      hasGroupDefault: Boolean(groupDefault),
      /** When the row in force was last changed — null while the built-in default applies. */
      updatedAt: (own ?? groupDefault)?.updatedAt.toISOString() ?? null,
    };
  }

  /** Every configured policy, for the settings screen. */
  async list() {
    await requireScope(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.attendancePolicy.findMany({
      include: { clinic: { select: { name: true } } },
      orderBy: [{ clinicId: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      clinicId: row.clinicId,
      clinicName: row.clinic?.name ?? null,
      scope: row.clinicId ? 'CLINIC' : 'GROUP_DEFAULT',
      policy: resolveAttendancePolicy([row], row.clinicId),
    }));
  }

  /**
   * Save the group default (`clinicId` omitted) or one clinic's override.
   *
   * Upsert on the natural key rather than an id, so the settings screen never
   * has to know whether a row exists — and so two people saving at once cannot
   * produce two policies for one clinic.
   */
  async save(dto: SaveAttendancePolicyDto) {
    return withAdminTx(this.rawPrisma, 'hr.attendance.manage', async (tx, actor) => {
      const clinicId = dto.clinicId ?? null;
      const before = await tx.attendancePolicy.findFirst({ where: { clinicId } });
      const fields: Partial<AttendancePolicy> = {
        lateGraceMinutes: dto.lateGraceMinutes,
        earlyOutGraceMinutes: dto.earlyOutGraceMinutes,
        overtimeMinimumMinutes: dto.overtimeMinimumMinutes,
        overtimeRoundingMinutes: dto.overtimeRoundingMinutes,
        countEarlyClockIn: dto.countEarlyClockIn,
        maximumShiftHours: dto.maximumShiftHours,
        geofenceRadiusMetres: dto.geofenceRadiusMetres,
      };
      const data: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      // The point is one fact: written together, cleared together.
      if (dto.geofenceLat !== undefined || dto.geofenceLng !== undefined) {
        const lat = dto.geofenceLat ?? null;
        const lng = dto.geofenceLng ?? null;
        if ((lat === null) !== (lng === null)) {
          throw new BadRequestException('A geofence needs both a latitude and a longitude, or neither.');
        }
        data.geofenceLat = lat;
        data.geofenceLng = lng;
      }

      const saved = before
        ? await tx.attendancePolicy.update({
            where: { id: before.id },
            data: { ...data, updatedByStaffId: actor.id },
          })
        : await tx.attendancePolicy.create({
            data: { ...data, tenantId: currentTenantId(), clinicId, updatedByStaffId: actor.id },
          });

      await recordAudit(tx, actor, {
        action: 'attendancePolicy.saved',
        entityType: 'AttendancePolicy',
        entityId: saved.id,
        before: before ? resolveAttendancePolicy([before], clinicId) : null,
        after: resolveAttendancePolicy([saved], clinicId),
        reason: dto.reason,
        source: 'hr.attendance',
      });

      return { id: saved.id, clinicId, policy: resolveAttendancePolicy([saved], clinicId) };
    });
  }
}
