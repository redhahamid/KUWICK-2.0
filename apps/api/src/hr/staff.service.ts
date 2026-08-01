import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { normaliseRegistrationNo } from '../clinical/clinical-authorization';
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

  async update(id: string, dto: UpdateStaffDto) {
    const existing = await this.findById(id);
    const data: Prisma.StaffUncheckedUpdateInput = { ...dto, ...this.professionalAudit(dto, existing) };
    return this.prisma.staff.update({ where: { id }, data });
  }

  // C0 (D-051) — professional verification and signing-enable are AUDITED
  // events, not plain fields: the timestamp and the acting staff member are
  // stamped server-side the moment a Clinic Group turns them on, and cleared
  // when turned off so a stale "verified" timestamp can never linger behind
  // a disabled flag. The client cannot set them directly.
  //
  // These record only that THE CLINIC GROUP asserted the practitioner's
  // status — Kuwick performs no MMC registry lookup, and the UI says so.
  private professionalAudit(dto: UpdateStaffDto, existing: { professionalActive: boolean; canSignClinicalNotes: boolean }) {
    const actor = currentStaffId() ?? null;
    const now = new Date();
    const audit: Prisma.StaffUncheckedUpdateInput = {};

    if (dto.professionalActive !== undefined && dto.professionalActive !== existing.professionalActive) {
      audit.professionalVerifiedAt = dto.professionalActive ? now : null;
      audit.professionalVerifiedByStaffId = dto.professionalActive ? actor : null;
    }
    if (dto.canSignClinicalNotes !== undefined && dto.canSignClinicalNotes !== existing.canSignClinicalNotes) {
      audit.clinicalSigningEnabledAt = dto.canSignClinicalNotes ? now : null;
      audit.clinicalSigningEnabledByStaffId = dto.canSignClinicalNotes ? actor : null;
    }
    if (dto.medicalRegistrationNo !== undefined) {
      audit.medicalRegistrationNoNormalised = normaliseRegistrationNo(dto.medicalRegistrationNo);
    }
    return audit;
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
