import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProfessionalAuditField, Role, Staff } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { normaliseRegistrationNo } from '../clinical/clinical-authorization';
import { can } from '../core/permissions';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

const DOCTOR_ROLES: Role[] = [Role.DOCTOR_RESIDENT, Role.DOCTOR_LOCUM];
const PASSWORD_HASH_ROUNDS = 10;

@Injectable()
export class StaffService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  async create(dto: CreateStaffDto) {
    // FINAL-UAT hardening — creating an ACCOUNT is user management. This was
    // open to any valid token; `users.manage` (owner) now gates it, with the
    // legacy OWNER_ADMIN check kept as fallback for sessions predating
    // capability roles.
    await this.assertMayManageUsers();
    const { loginEmail, loginPassword, ...staffFields } = dto;
    const tenantId = currentTenantId();

    if (!loginEmail || !loginPassword) {
      return this.prisma.staff.create({ data: { ...staffFields, tenantId } });
    }

    let userId: string;
    try {
      const passwordHash = await bcrypt.hash(loginPassword, PASSWORD_HASH_ROUNDS);
      const user = await this.prisma.user.create({
        data: { tenantId, email: loginEmail, passwordHash },
      });
      userId = user.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A user with this email already exists for this clinic');
      }
      throw error;
    }

    return this.prisma.staff.create({ data: { ...staffFields, userId, tenantId } });
  }

  findAll() {
    return this.prisma.staff.findMany({ orderBy: { fullName: 'asc' } });
  }

  async findById(id: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) {
      throw new NotFoundException('Staff not found');
    }
    return staff;
  }

  // Fields whose change is medicolegally significant: they decide who may
  // electronically sign a clinical note.
  private static readonly PROFESSIONAL_FIELDS = [
    'professionalType',
    'medicalRegistrationNo',
    'professionalActive',
    'canSignClinicalNotes',
  ] as const;

  async update(id: string, dto: UpdateStaffDto) {
    // FINAL-UAT hardening — role, branch and active are access-control
    // facts; editing anybody's staff record is user management.
    await this.assertMayManageUsers();
    const existing = await this.findById(id);
    // professionalChangeReason is audit metadata, not a Staff column — it is
    // recorded on the audit rows and must never reach the Prisma update.
    const { professionalChangeReason, ...staffFields } = dto;
    const touchesProfessional = StaffService.PROFESSIONAL_FIELDS.some((f) => staffFields[f] !== undefined);

    if (touchesProfessional) {
      await this.assertMayChangeProfessionalIdentity();
    }

    const derived = this.derivedProfessionalFields(staffFields, existing);
    const data: Prisma.StaffUncheckedUpdateInput = { ...staffFields, ...derived };
    const updated = await this.prisma.staff.update({ where: { id }, data });

    if (touchesProfessional) {
      await this.writeProfessionalAudit(existing, updated, professionalChangeReason ?? null);
    }
    return updated;
  }

  // C0 closure — only a clinic OWNER_ADMIN may alter professional identity or
  // clinical-signing permission. Without this, any authenticated account could
  // grant itself the right to sign clinical notes, which would make the whole
  // eligibility check decorative.
  //
  // Deliberately narrow: the rest of the staff record (name, role, branch)
  // keeps its existing unrestricted behaviour, consistent with the app's
  // wider RBAC gap, which is tracked as its own phase. This gate protects the
  // fields that carry medicolegal weight, not everything.
  private async assertMayChangeProfessionalIdentity(): Promise<void> {
    const actorId = currentStaffId();
    if (!actorId) {
      throw new ForbiddenException('No authenticated staff member on this session');
    }
    const actor = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (!actor || !actor.active || actor.role !== Role.OWNER_ADMIN) {
      throw new ForbiddenException(
        'Only a clinic owner/administrator may change professional identity or clinical-signing permission',
      );
    }
  }

  // FINAL-UAT — permission-first with the legacy job title as fallback, so a
  // capability-composed owner and a legacy OWNER_ADMIN both pass, and nobody
  // loses an ability they had. Assignments are read here (not through
  // requireActor) because this service runs on the scoped client.
  private async assertMayManageUsers(): Promise<void> {
    const actorId = currentStaffId();
    if (!actorId) {
      throw new ForbiddenException('No authenticated staff member on this session');
    }
    const actor = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (!actor || !actor.active) {
      throw new ForbiddenException('Your staff account is inactive');
    }
    const assignments = await this.prisma.staffRoleAssignment.findMany({
      where: { staffId: actorId },
      select: { role: true },
    });
    const roles = assignments
      .map((row) => row.role)
      .filter((role): role is NonNullable<typeof role> => role !== null);
    if (can(actor, 'users.manage', roles) || actor.role === Role.OWNER_ADMIN) return;
    throw new ForbiddenException('Only an owner may manage users and roles.');
  }

  // C0 (D-051) — professional verification and signing-enable are AUDITED
  // events, not plain fields: the timestamp and the acting staff member are
  // stamped server-side the moment a Clinic Group turns them on, and cleared
  // when turned off so a stale "verified" timestamp can never linger behind
  // a disabled flag. The client cannot set them directly.
  //
  // These record only that THE CLINIC GROUP asserted the practitioner's
  // status — Kuwick performs no MMC registry lookup, and the UI says so.
  private derivedProfessionalFields(
    dto: UpdateStaffDto,
    existing: { professionalActive: boolean; canSignClinicalNotes: boolean },
  ) {
    const actor = currentStaffId() ?? null;
    const now = new Date();
    const derived: Prisma.StaffUncheckedUpdateInput = {};

    if (dto.professionalActive !== undefined && dto.professionalActive !== existing.professionalActive) {
      derived.professionalVerifiedAt = dto.professionalActive ? now : null;
      derived.professionalVerifiedByStaffId = dto.professionalActive ? actor : null;
    }
    if (dto.canSignClinicalNotes !== undefined && dto.canSignClinicalNotes !== existing.canSignClinicalNotes) {
      derived.clinicalSigningEnabledAt = dto.canSignClinicalNotes ? now : null;
      derived.clinicalSigningEnabledByStaffId = dto.canSignClinicalNotes ? actor : null;
    }
    if (dto.medicalRegistrationNo !== undefined) {
      derived.medicalRegistrationNoNormalised = normaliseRegistrationNo(dto.medicalRegistrationNo);
    }
    return derived;
  }

  // Append-only, one row per field that actually changed. `updatedAt` on Staff
  // cannot answer "who granted this doctor the right to sign, and when" — this
  // can. Derived timestamp/actor fields are audited too, so the verification
  // trail is complete even though the client never sets them.
  private async writeProfessionalAudit(before: Staff, after: Staff, reason: string | null): Promise<void> {
    const actorId = currentStaffId() ?? null;
    const actor = actorId ? await this.prisma.staff.findUnique({ where: { id: actorId } }) : null;
    const str = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

    const changes: { field: ProfessionalAuditField; prev: unknown; next: unknown }[] = [
      { field: ProfessionalAuditField.PROFESSIONAL_TYPE, prev: before.professionalType, next: after.professionalType },
      { field: ProfessionalAuditField.MEDICAL_REGISTRATION_NO, prev: before.medicalRegistrationNo, next: after.medicalRegistrationNo },
      { field: ProfessionalAuditField.PROFESSIONAL_ACTIVE, prev: before.professionalActive, next: after.professionalActive },
      { field: ProfessionalAuditField.PROFESSIONAL_VERIFIED_AT, prev: before.professionalVerifiedAt, next: after.professionalVerifiedAt },
      { field: ProfessionalAuditField.PROFESSIONAL_VERIFIED_BY, prev: before.professionalVerifiedByStaffId, next: after.professionalVerifiedByStaffId },
      { field: ProfessionalAuditField.CAN_SIGN_CLINICAL_NOTES, prev: before.canSignClinicalNotes, next: after.canSignClinicalNotes },
      { field: ProfessionalAuditField.CLINICAL_SIGNING_ENABLED_AT, prev: before.clinicalSigningEnabledAt, next: after.clinicalSigningEnabledAt },
      { field: ProfessionalAuditField.CLINICAL_SIGNING_ENABLED_BY, prev: before.clinicalSigningEnabledByStaffId, next: after.clinicalSigningEnabledByStaffId },
    ].filter((c) => str(c.prev) !== str(c.next));

    if (changes.length === 0) {
      return;
    }

    await this.prisma.staffProfessionalAudit.createMany({
      data: changes.map((c) => ({
        tenantId: currentTenantId(),
        // Branch context AT THE TIME of the change — recorded, not resolved
        // later, since a staff member's home branch can move.
        clinicId: after.clinicId,
        staffId: after.id,
        field: c.field,
        previousValue: str(c.prev),
        newValue: str(c.next),
        changedByStaffId: actorId,
        changedByNameSnapshot: actor?.fullName ?? null,
        changedByRoleSnapshot: actor?.role ?? null,
        reason,
      })),
    });
  }

  listProfessionalAudit(staffId: string) {
    return this.prisma.staffProfessionalAudit.findMany({
      where: { staffId },
      orderBy: { changedAt: 'desc' },
    });
  }

  // The only surface AppointmentModule is allowed to call — it never touches
  // the Staff Prisma model directly (docs/CODING_STANDARDS.md §3).
  async isActiveDoctor(staffId: string): Promise<boolean> {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    return Boolean(staff && staff.active && DOCTOR_ROLES.includes(staff.role));
  }

  async assertActiveDoctor(staffId: string): Promise<void> {
    if (!(await this.isActiveDoctor(staffId))) {
      throw new NotFoundException('Staff member is not an active doctor');
    }
  }
}
