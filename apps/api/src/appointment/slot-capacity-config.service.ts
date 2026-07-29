import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateSlotCapacityConfigDto } from './dto/create-slot-capacity-config.dto';
import { UpdateSlotCapacityConfigDto } from './dto/update-slot-capacity-config.dto';

@Injectable()
export class SlotCapacityConfigService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateSlotCapacityConfigDto) {
    return this.prisma.slotCapacityConfig.create({
      data: { ...dto, tenantId: currentTenantId() },
    });
  }

  findAll(filter: { staffId?: string; clinicId?: string; serviceId?: string }) {
    return this.prisma.slotCapacityConfig.findMany({ where: filter });
  }

  async update(id: string, dto: UpdateSlotCapacityConfigDto) {
    await this.assertExists(id);
    return this.prisma.slotCapacityConfig.update({ where: { id }, data: dto });
  }

  private async assertExists(id: string) {
    const config = await this.prisma.slotCapacityConfig.findUnique({ where: { id } });
    if (!config) {
      throw new NotFoundException('Slot capacity config not found');
    }
    return config;
  }
}
