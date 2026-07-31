import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreatePanelClinicDto, UpdatePanelClinicDto } from './dto/create-panel-clinic.dto';

@Injectable()
export class PanelClinicService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  create(dto: CreatePanelClinicDto) {
    return this.prisma.panelClinic.create({ data: { ...dto, tenantId: currentTenantId() } });
  }

  findAll(activeOnly?: boolean) {
    return this.prisma.panelClinic.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const panel = await this.prisma.panelClinic.findUnique({ where: { id } });
    if (!panel) {
      throw new NotFoundException('Panel clinic not found');
    }
    return panel;
  }

  update(id: string, dto: UpdatePanelClinicDto) {
    return this.prisma.panelClinic.update({ where: { id }, data: dto });
  }
}
