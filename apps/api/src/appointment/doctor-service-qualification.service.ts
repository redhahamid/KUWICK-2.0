import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateDoctorServiceQualificationDto } from './dto/create-doctor-service-qualification.dto';

@Injectable()
export class DoctorServiceQualificationService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateDoctorServiceQualificationDto) {
    return this.prisma.doctorServiceQualification.create({
      data: { ...dto, tenantId: currentTenantId() },
    });
  }

  findAll(filter: { staffId?: string }) {
    return this.prisma.doctorServiceQualification.findMany({ where: filter });
  }

  async remove(id: string) {
    const qualification = await this.prisma.doctorServiceQualification.findUnique({
      where: { id },
    });
    if (!qualification) {
      throw new NotFoundException('Doctor service qualification not found');
    }
    await this.prisma.doctorServiceQualification.delete({ where: { id } });
  }
}
