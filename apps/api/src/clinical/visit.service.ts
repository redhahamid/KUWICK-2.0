import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { ClinicalTx, withTenantTx } from './clinical-actor';

export interface CreateVisitInput {
  clinicId: string;
  patientId: string;
  staffId: string;
  billingType: string;
  panelClinicId?: string;
  presentingComplaint?: string;
}

export interface FindVisitsFilter {
  clinicId?: string;
  patientId?: string;
}

// G4c1 (D-068) — the visible format, unchanged: "V-000001".
const VISIT_NUMBER_PREFIX = 'V-';
const VISIT_NUMBER_DIGITS = 6;
// Bounded: a collision advances the counter past the conflicting row, so two
// attempts always suffice in practice. The third exists so a pathological
// state ends in a controlled error rather than a loop.
const MAX_ALLOCATION_ATTEMPTS = 3;

export function formatVisitNumber(value: number): string {
  return `${VISIT_NUMBER_PREFIX}${String(value).padStart(VISIT_NUMBER_DIGITS, '0')}`;
}

/**
 * Is this the visit-number unique index rejecting the insert?
 *
 * Measured, not assumed: under the pg driver adapter Prisma raises P2002 with
 * `meta.target` reported as "(not available)" — the constraint name survives
 * only in the nested driver error. So the name is read where it exists, and
 * where it does not, a P2002 from the visit insert is treated as the
 * visit-number conflict: `visits` carries exactly two unique constraints, and
 * the other is a server-generated uuid primary key.
 */
function isVisitNumberConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const named = Array.isArray(target) ? target.join(',') : String(target ?? '');
  if (named.includes('visit_number') || named.includes('visitNumber')) {
    return true;
  }
  // Best effort: the driver adapter keeps the real constraint name nested.
  const nested = JSON.stringify(error.meta ?? {});
  if (nested.includes('visits_tenant_id_visit_number_key')) {
    return true;
  }
  // Unidentifiable target: the only other unique constraint on `visits` is its
  // uuid primary key, so retrying is both correct and harmless.
  return named === '' || named === 'undefined' || named.includes('not available');
}

@Injectable()
export class VisitService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * Allocate the next visit number for the current tenant.
   *
   * One statement, and that matters: `INSERT … ON CONFLICT DO UPDATE … RETURNING`
   * takes a row lock and increments atomically, so concurrent registrations
   * serialise on this row instead of racing a read-then-write. Running inside
   * the caller's transaction means a failed visit insert rolls the increment
   * back too — the number is not consumed by a visit that never existed, and
   * it is never reissued because a visit was later deleted.
   */
  private async allocateVisitNumber(tx: ClinicalTx): Promise<string> {
    const tenantId = currentTenantId();
    const rows = await tx.$queryRaw<{ next_value: number }[]>`
      INSERT INTO "visit_number_counters" ("tenant_id", "next_value", "updated_at")
      VALUES (${tenantId}, 1, now())
      ON CONFLICT ("tenant_id") DO UPDATE
        SET "next_value" = "visit_number_counters"."next_value" + 1,
            "updated_at" = now()
      RETURNING "next_value"`;
    const next = rows[0]?.next_value;
    if (!next) {
      throw new ConflictException('Could not allocate a visit number. Please try again.');
    }
    return formatVisitNumber(next);
  }

  /**
   * Advance a tenant's counter past every number already in use.
   *
   * Only reached when a visit insert hit the unique index — which means the
   * counter is behind reality (a number written outside the allocator, or a
   * legacy row). Runs in its own transaction so the retry can see it: the
   * attempt that failed has already rolled back, taking its increment with it.
   */
  private async repairCounter(): Promise<void> {
    const tenantId = currentTenantId();
    await withTenantTx(this.rawPrisma, async (tx) => {
      await tx.$executeRaw`
        UPDATE "visit_number_counters"
           SET "next_value" = GREATEST(
                 "next_value",
                 COALESCE((
                   SELECT MAX(substring("visit_number" FROM 3)::INTEGER)
                     FROM "visits"
                    WHERE "tenant_id" = ${tenantId}
                      AND "visit_number" ~ '^V-[0-9]{1,9}$'
                 ), 0)
               ),
               "updated_at" = now()
         WHERE "tenant_id" = ${tenantId}`;
    });
  }

  // A panel visit's billingType is derived from the panel's own name, not
  // trusted from client-supplied text (docs/DECISIONS.md D-028-style
  // reasoning: the panel is the source of truth for what it's called on a
  // bill, same as OrderService/Diagnosis snapshot from their catalogs).
  private async resolveBillingType(tx: ClinicalTx, input: CreateVisitInput): Promise<string> {
    if (!input.panelClinicId) {
      return input.billingType;
    }
    const panel = await tx.panelClinic.findUnique({ where: { id: input.panelClinicId } });
    if (!panel) {
      throw new NotFoundException('Panel clinic not found');
    }
    return panel.name;
  }

  /**
   * The single visit-creation path. Every entry point reaches it — the Patient
   * Dashboard's "New Visit" (POST /visits), the front desk's "Add to Daily
   * Queue" (QueueTicketService.addToQueue) and an appointment arriving
   * (AppointmentService.arrived → addToQueue) — so there is one allocator and
   * no second place to forget it.
   */
  async create(input: CreateVisitInput) {
    for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      try {
        return await withTenantTx(this.rawPrisma, async (tx) => {
          const billingType = await this.resolveBillingType(tx, input);
          const visitNumber = await this.allocateVisitNumber(tx);
          return tx.visit.create({
            data: {
              tenantId: currentTenantId(),
              clinicId: input.clinicId,
              patientId: input.patientId,
              staffId: input.staffId,
              billingType,
              panelClinicId: input.panelClinicId,
              presentingComplaint: input.presentingComplaint,
              visitNumber,
            },
          });
        });
      } catch (error) {
        if (!isVisitNumberConflict(error)) {
          throw error;
        }
        // The whole attempt rolled back, so nothing partial survives and no
        // phantom visit is visible. Advance past the conflict and try again.
        if (attempt === MAX_ALLOCATION_ATTEMPTS) {
          throw new ConflictException(
            'Could not allocate a unique visit number after several attempts. Please try again, or contact support if this persists.',
          );
        }
        await this.repairCounter();
      }
    }
    // Unreachable: the loop either returns or throws.
    throw new ConflictException('Could not allocate a visit number. Please try again.');
  }

  findAll(filter: FindVisitsFilter) {
    return this.prisma.visit.findMany({
      where: { clinicId: filter.clinicId, patientId: filter.patientId },
      include: { staff: true, queueTicket: true },
      orderBy: { checkInAt: 'desc' },
    });
  }

  async findById(id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: { staff: true, patient: true, queueTicket: true },
    });
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }
    return visit;
  }

  async checkOut(id: string) {
    await this.findById(id);
    return this.prisma.visit.update({ where: { id }, data: { checkOutAt: new Date() } });
  }
}
