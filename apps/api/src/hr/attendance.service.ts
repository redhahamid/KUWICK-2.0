import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requireScope } from '../finance/admin-actor';

export interface AttendanceQuery {
  from?: string;
  to?: string;
  clinicId?: string;
  staffId?: string;
}

function dateRangeWhere(field: string, query: AttendanceQuery) {
  const gte = query.from ? new Date(query.from) : undefined;
  const lte = query.to ? new Date(new Date(query.to).setHours(23, 59, 59, 999)) : undefined;
  if (!gte && !lte) return {};
  return { [field]: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } };
}

// HR, Phase 1c. Attendance has no table of its own — it's derived from
// Visit.checkInAt/checkOutAt (PRODUCT_REQUIREMENTS.md §4 traceability
// table: "attendance via clinical check-in/out"), read-only, same
// cross-module read pattern as Reports (docs/CODING_STANDARDS.md §3: this
// module never writes to Visit, only reads it via its own tenant-scoped
// query — no different from Reports reading Invoice/Appointment).
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * AUTHORISE, THEN SCOPE.
   *
   * This service had no authorisation call of any kind and passed `clinicId`
   * from the query string into Prisma, so who worked which shift at which
   * branch was readable by anybody who could reach the route.
   */
  private async readScope() {
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    return scope;
  }

  async getAttendance(query: AttendanceQuery) {
    const scope = await this.readScope();
    const visits = await this.prisma.visit.findMany({
      where: {
        ...dateRangeWhere('checkInAt', query),
        ...scope.where(query.clinicId),
        ...(query.staffId ? { staffId: query.staffId } : {}),
      },
      select: { staffId: true, staff: { select: { fullName: true } }, checkInAt: true, checkOutAt: true },
      orderBy: { checkInAt: 'asc' },
    });

    const byStaffDay = new Map<
      string,
      { staffId: string; staffName: string; date: string; firstCheckIn: Date; lastCheckOut: Date | null; visitCount: number }
    >();

    for (const visit of visits) {
      // S3c (D-082) — attendance is derived from visits, so a visit with no
      // attending clinician contributes nothing: it is evidence that a
      // PATIENT arrived, not that any particular doctor was present. Counting
      // it would either crash or invent a shift for nobody.
      if (!visit.staffId || !visit.staff) {
        continue;
      }
      const date = visit.checkInAt.toISOString().slice(0, 10);
      const key = `${visit.staffId}:${date}`;
      const bucket = byStaffDay.get(key) ?? {
        staffId: visit.staffId,
        staffName: visit.staff.fullName,
        date,
        firstCheckIn: visit.checkInAt,
        lastCheckOut: visit.checkOutAt,
        visitCount: 0,
      };
      bucket.visitCount += 1;
      if (visit.checkInAt < bucket.firstCheckIn) bucket.firstCheckIn = visit.checkInAt;
      if (visit.checkOutAt && (!bucket.lastCheckOut || visit.checkOutAt > bucket.lastCheckOut)) {
        bucket.lastCheckOut = visit.checkOutAt;
      }
      byStaffDay.set(key, bucket);
    }

    return Array.from(byStaffDay.values()).sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName));
  }
}
