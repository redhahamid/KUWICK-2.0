import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateItemAgeDosageDto } from './dto/create-item-age-dosage.dto';

@Injectable()
export class ItemAgeDosageService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  findByItemId(itemId: string) {
    return this.prisma.itemAgeDosage.findMany({ where: { itemId }, orderBy: { ageFromMonths: 'asc' } });
  }

  create(dto: CreateItemAgeDosageDto) {
    return this.prisma.itemAgeDosage.create({ data: { ...dto, tenantId: currentTenantId() } });
  }

  remove(id: string) {
    return this.prisma.itemAgeDosage.delete({ where: { id } });
  }
}
