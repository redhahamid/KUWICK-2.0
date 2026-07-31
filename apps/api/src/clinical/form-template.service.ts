import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateFormTemplateDto } from './dto/create-form-template.dto';
import { UpdateFormTemplateDto } from './dto/update-form-template.dto';

@Injectable()
export class FormTemplateService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  create(dto: CreateFormTemplateDto) {
    return this.prisma.formTemplate.create({
      data: {
        tenantId: currentTenantId(),
        name: dto.name,
        serviceCatalogId: dto.serviceCatalogId,
        fields: dto.fields as object[],
      },
    });
  }

  // The owner's audited kuwick.com "Result Form Builder" is 1:1 with a
  // service (edited inline in the Service drawer, not a standalone
  // reusable-template list) — this is how CompleteOrderModal looks up
  // which form (if any) applies to an order's service.
  findByServiceCatalogId(serviceCatalogId: string) {
    return this.prisma.formTemplate.findFirst({
      where: { serviceCatalogId, active: true },
    });
  }

  async findById(id: string) {
    const template = await this.prisma.formTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Form template not found');
    }
    return template;
  }

  async update(id: string, dto: UpdateFormTemplateDto) {
    await this.findById(id);
    return this.prisma.formTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        serviceCatalogId: dto.serviceCatalogId,
        fields: dto.fields as object[] | undefined,
        active: dto.active,
      },
    });
  }
}
