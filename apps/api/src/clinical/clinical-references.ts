import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Staff } from '@prisma/client';
import { branchContext, ClinicalTx } from './clinical-actor';
import { hasBranchAccess } from './clinical-authorization';
import { isEligibleAttendingDoctor } from './queue-authorization';

/**
 * D-069 / S1 — resolve-before-write, in one place.
 *
 * A foreign key accepting an id is not permission to use it: RLS filters
 * READS, but a foreign key is enforced below it and does not care which tenant
 * is asking. So an id arriving from a browser must be looked up on a
 * tenant-scoped transaction before anything is written with it, and the row
 * that comes back — not the request value — is what gets stored.
 *
 * These helpers were extracted from `VisitService` when appointment creation
 * needed the same rules. One copy, deliberately: two implementations of a
 * tenant boundary is how one of them quietly becomes the weaker one.
 *
 * Every "not found" below is the SAME response for a row that does not exist
 * and a row that belongs to another tenant, because RLS makes the second
 * genuinely absent. That is what stops the endpoint being used to probe for
 * patients, staff or clinics in other clinics.
 */

export async function resolvePatient(tx: ClinicalTx, patientId: string) {
  const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true, name: true } });
  if (!patient) {
    throw new NotFoundException('Patient not found');
  }
  return patient;
}

/**
 * The clinic, plus the acting user's right to work in it — the project's
 * existing branch rule, not a local re-statement of it.
 */
export async function resolveClinicForActor(tx: ClinicalTx, clinicId: string, actor: Staff) {
  const clinic = await tx.clinic.findUnique({ where: { id: clinicId }, select: { id: true, name: true } });
  if (!clinic) {
    throw new NotFoundException('Clinic not found');
  }
  // NOTE: `Clinic` has no `active` flag in the current schema, so there is no
  // activation state to check. Nothing is invented to fill the gap.
  if (!hasBranchAccess(actor, clinic.id, await branchContext(tx, actor))) {
    throw new ForbiddenException(
      'You are not authorised for this branch. Ask an administrator to assign your branch or grant explicit access.',
    );
  }
  return clinic;
}

/**
 * A staff member who may be recorded against work at this branch.
 *
 * Deliberately NOT restricted to a clinical role: D-044 registers a walk-in
 * before anyone knows which doctor will see the patient, and the Queue's call
 * step reassigns later. Callers that DO need a doctor (appointment booking)
 * keep their own qualification rule on top of this.
 */
export async function resolveActiveStaffForClinic(tx: ClinicalTx, staffId: string, clinicId: string) {
  const staff = await tx.staff.findUnique({ where: { id: staffId } });
  if (!staff) {
    throw new NotFoundException('Staff member not found');
  }
  if (!staff.active) {
    throw new BadRequestException('That staff member is not active.');
  }
  if (!hasBranchAccess(staff, clinicId, await branchContext(tx, staff))) {
    throw new BadRequestException(
      'That staff member is not authorised for this branch, so they cannot be recorded against work there.',
    );
  }
  return staff;
}

/**
 * S3c (D-082) — a staff member who may be recorded as a visit's ATTENDING
 * CLINICIAN. Everything `resolveActiveStaffForClinic` checks, plus the one
 * thing that separates attending from merely present: they have to be a
 * doctor.
 *
 * Before S3c this check did not exist anywhere, because `Visit.staffId` was
 * required and front desk had to put someone in it — so "the attending
 * clinician is a doctor" could not be enforced without breaking walk-in
 * registration. Now that the field is nullable, it can be.
 */
export async function resolveEligibleAttendingDoctor(
  tx: ClinicalTx,
  staffId: string,
  clinicId: string,
): Promise<Staff> {
  const staff = await resolveActiveStaffForClinic(tx, staffId, clinicId);
  if (!isEligibleAttendingDoctor(staff)) {
    throw new BadRequestException(
      'Only an active doctor can be recorded as the attending clinician for a visit.',
    );
  }
  return staff;
}

/** A catalogue entry, resolved in this tenant. */
export async function resolveService(tx: ClinicalTx, serviceId: string) {
  const service = await tx.serviceCatalog.findUnique({
    where: { id: serviceId },
    select: { id: true, name: true, active: true },
  });
  if (!service) {
    throw new NotFoundException('Service not found');
  }
  if (service.active === false) {
    throw new BadRequestException('That service is no longer available.');
  }
  return service;
}
