import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

const DOCTOR_ROLES: Role[] = [Role.DOCTOR_RESIDENT, Role.DOCTOR_LOCUM];

@Injectable()
export class StaffService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateStaffDto) {
    return this.prisma.staff.create({ data: { ...dto, tenantId: currentTenantId() } });
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

  update(id: string, dto: UpdateStaffDto) {
    return this.prisma.staff.update({ where: { id }, data: dto });
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
