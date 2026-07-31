import { Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from './tenant-scoped-prisma.provider';
import { currentTenantId } from './tenant-context';
import { CreateClinicDto, UpdateClinicDto } from './dto/create-clinic.dto';

@Injectable()
export class ClinicService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateClinicDto) {
    return this.prisma.clinic.create({ data: { ...dto, tenantId: currentTenantId() } });
  }

  findAll() {
    return this.prisma.clinic.findMany({ orderBy: { name: 'asc' } });
  }

  update(id: string, dto: UpdateClinicDto) {
    return this.prisma.clinic.update({ where: { id }, data: dto });
  }
}
