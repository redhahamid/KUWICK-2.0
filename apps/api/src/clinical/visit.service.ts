import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { branchContext, ClinicalTx, requireActor, withTenantTx } from './clinical-actor';
import { hasBranchAccess } from './clinical-authorization';

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

  /**
   * G4c1 closure (D-069) — every id in the request is resolved under the
   * authenticated tenant before anything is written.
   *
   * The defect this closes was found by G4c1's own verification: a token for
   * one tenant could create a visit using ANOTHER tenant's patientId. RLS
   * protects reads, but a foreign key is enforced below RLS, so the insert
   * simply succeeded and produced a visit whose patient was invisible to the
   * tenant that owned the visit. A foreign key accepting an id is not
   * evidence that the caller may use it.
   *
   * Every lookup below runs on `tx`, which has `app.tenant_id` set, so a row
   * belonging to another tenant is not "found" at all — the same code path
   * that reports a genuinely unknown id reports an inaccessible one, and the
   * response cannot be used to probe for cross-tenant existence.
   */
  private async resolvePatient(tx: ClinicalTx, patientId: string) {
    const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true, name: true } });
    if (!patient) {
      // Deliberately identical for "does not exist" and "belongs to another
      // tenant". Distinguishing them would leak the existence of a patient.
      throw new NotFoundException('Patient not found');
    }
    return patient;
  }

  private async resolveClinic(tx: ClinicalTx, clinicId: string, actor: Staff) {
    const clinic = await tx.clinic.findUnique({ where: { id: clinicId }, select: { id: true, name: true } });
    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }
    // NOTE: `Clinic` has no `active` flag in the current schema, so there is
    // no activation state to check here. Nothing is invented to fill the gap;
    // if branch deactivation is introduced later, this is where it belongs.
    // The project's existing branch rule, not a weaker copy of it.
    if (!hasBranchAccess(actor, clinic.id, await branchContext(tx, actor))) {
      throw new ForbiddenException(
        'You are not authorised for this branch. Ask an administrator to assign your branch or grant explicit access.',
      );
    }
    return clinic;
  }

  /**
   * The visit's attending staff member.
   *
   * Deliberately NOT restricted to a doctor role. D-044 established that a
   * walk-in is often added before anyone knows which doctor will see the
   * patient, and the Queue's call step reassigns `visit.staffId` at that
   * point. Requiring a clinical role here would break front-desk
   * registration, so what is enforced is what the record must be able to
   * claim: the staff member exists in this tenant, is active, and is
   * authorised for the branch the visit is being created in.
   */
  private async resolveAttendingStaff(tx: ClinicalTx, staffId: string, clinicId: string) {
    const staff = await tx.staff.findUnique({ where: { id: staffId } });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    if (!staff.active) {
      throw new BadRequestException('That staff member is not active.');
    }
    if (!hasBranchAccess(staff, clinicId, await branchContext(tx, staff))) {
      throw new BadRequestException(
        'That staff member is not authorised for this branch, so they cannot be recorded as attending.',
      );
    }
    return staff;
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
          const patient = await this.resolvePatient(tx, input.patientId);
          const clinic = await this.resolveClinic(tx, input.clinicId, actor);
          const attending = await this.resolveAttendingStaff(tx, input.staffId, clinic.id);
          const billingType = await this.resolveBillingType(tx, input);

          const visitNumber = await this.allocateVisitNumber(tx);
          return tx.visit.create({
            data: {
              tenantId: currentTenantId(),
              // Resolved rows, not the raw request values.
              clinicId: clinic.id,
              patientId: patient.id,
              staffId: attending.id,
              billingType,
              panelClinicId: input.panelClinicId,
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
}
