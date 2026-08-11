import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Staff, VisitClassification } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { ClinicalTx, assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { assertCanPerformBilling } from './clinical-authorization';
import {
  resolveActiveStaffForClinic,
  resolveEligibleAttendingDoctor,
  resolveClinicForActor,
  resolvePatient,
} from './clinical-references';

export interface CreateVisitInput {
  clinicId: string;
  patientId: string;
  /**
   * S3c (D-082) — the ATTENDING CLINICIAN, and now OPTIONAL.
   *
   * Front desk registering a walk-in nobody has been assigned to yet leaves
   * this out, and the visit is stored with no attending clinician rather than
   * with the registrar impersonating one. Who registered the visit is taken
   * from the authenticated actor, never from the request.
   */
  staffId?: string;
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
/**
 * The six-digit format's real ceiling. Exceeding it would silently widen every
 * printed number to seven digits and break the fixed-width assumption the
 * clinic's paperwork and the sort order rely on, so it is refused instead.
 */
export const MAX_VISIT_NUMBER = 999999;
/**
 * One initial attempt plus exactly ONE repair-and-retry.
 *
 * A collision can only mean the counter is behind a number written outside the
 * allocator; the repair advances it past every number in use, so a second
 * failure indicates something this code cannot reason about and must surface
 * as a controlled error rather than loop.
 */
const MAX_ALLOCATION_ATTEMPTS = 2;

export function formatVisitNumber(value: number): string {
  return `${VISIT_NUMBER_PREFIX}${String(value).padStart(VISIT_NUMBER_DIGITS, '0')}`;
}

/**
 * The constraint name behind a unique violation, wherever the driver put it.
 *
 * Measured against the real stack rather than assumed: under the pg driver
 * adapter Prisma reports `meta.target` as "(not available)", but the nested
 * driver error carries the true name — e.g.
 * `duplicate key value violates unique constraint "visits_tenant_id_visit_number_key"`.
 */
function conflictConstraint(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  const named = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return `${named} ${JSON.stringify(error.meta ?? {})}`;
}

/**
 * Is this specifically the (tenant_id, visit_number) index rejecting the insert?
 *
 * Deliberately narrow: it matches that one constraint by name and nothing
 * else, so an unrelated unique violation is never mistaken for a numbering
 * problem and silently retried.
 */
export function isVisitNumberConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const where = conflictConstraint(error);
  return where.includes('visits_tenant_id_visit_number_key') || /visit_?[nN]umber/.test(where);
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
    if (next > MAX_VISIT_NUMBER) {
      // The transaction rolls back, so the counter is not left past the
      // ceiling and the clinic can be migrated to a wider format deliberately.
      throw new ConflictException(
        `This clinic has reached the maximum visit number (${formatVisitNumber(MAX_VISIT_NUMBER)}). ` +
          'A wider visit-number format is required before more visits can be created.',
      );
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
          // Order matters (D-069): every relationship is validated BEFORE a
          // number is allocated, so a rejected request consumes nothing. The
          // allocation and the insert then share this transaction, so a
          // failed insert rolls the increment back with it.
          const actor = await requireActor(tx);
          const patient = await resolvePatient(tx, input.patientId);
          const clinic = await resolveClinicForActor(tx, input.clinicId, actor);
          // S3c — resolved only when one was actually chosen. An omitted
          // attending clinician is a real state now, not a missing argument
          // to be filled in with whoever happened to be at the keyboard.
          const attending = input.staffId
            ? await resolveEligibleAttendingDoctor(tx, input.staffId, clinic.id)
            : null;
          const billingType = await this.resolveBillingType(tx, input);

          const visitNumber = await this.allocateVisitNumber(tx);
          return tx.visit.create({
            data: {
              tenantId: currentTenantId(),
              // Resolved rows, not the raw request values.
              clinicId: clinic.id,
              patientId: patient.id,
              staffId: attending?.id ?? null,
              // Provenance, from the verified session only. A browser that
              // sends a registrar is ignored: "who typed this in" is not a
              // claim a caller gets to make about itself.
              registeredByStaffId: actor.id,
              billingType,
              panelClinicId: input.panelClinicId,
              // G4.5d3c-3b1a (D-092) — selecting a panel is not verifying it.
              // A panel visit starts PENDING_VERIFICATION; only an explicit,
              // attributed staff action moves it on. No panel, no state.
              panelVerificationStatus: input.panelClinicId ? 'PENDING_VERIFICATION' : undefined,
              presentingComplaint: input.presentingComplaint,
              visitNumber,
            },
          });
        });
      } catch (error) {
        if (!isVisitNumberConflict(error)) {
          // Every id is resolved above, so a foreign-key failure here means a
          // referenced row disappeared between validation and insert. Report
          // it as a conflict rather than letting a driver error reach the
          // client as a 500. Only P2003 is caught: an unrelated failure must
          // not be disguised as a validation problem.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
            throw new ConflictException(
              'One of the records this visit refers to changed while it was being created. Please try again.',
            );
          }
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

  /**
   * G4.5d3c-3b2 (D-094) — the visit's operational classification for
   * consultation billing (OTC-only, dressing-only, ...). Counter work:
   * front desk, finance and the owner; never a clinical judgement, never
   * inferred from diagnosis. Locked once the visit is completed — a settled
   * visit's billing basis is not quietly editable.
   */
  async setClassification(id: string, classification: VisitClassification) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformBilling(actor, 'CLASSIFY_VISIT');
      await assertMayTouchVisit(tx, id, actor);
      const visit = await tx.visit.findUnique({ where: { id }, select: { checkOutAt: true } });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }
      if (visit.checkOutAt) {
        throw new BadRequestException('This visit is completed; its billing classification is locked.');
      }
      return tx.visit.update({ where: { id }, data: { classification } });
    });
  }
}
