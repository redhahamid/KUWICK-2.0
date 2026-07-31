import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateDocumentTemplateDto, UpdateDocumentTemplateDto } from './dto/create-document-template.dto';

// Document builder (D-040) — the clinic's own template list: platform
// defaults copied in at tenant creation plus the clinic's own additions.
@Injectable()
export class DocumentTemplateService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  findAll(activeOnly = false) {
    return this.prisma.customDocumentTemplate.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateDocumentTemplateDto) {
    try {
      return await this.prisma.customDocumentTemplate.create({
        data: { ...dto, tenantId: currentTenantId() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A template with this name already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateDocumentTemplateDto) {
    const existing = await this.prisma.customDocumentTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Template not found');
    }
    try {
      return await this.prisma.customDocumentTemplate.update({ where: { id }, data: dto });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A template with this name already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.customDocumentTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Template not found');
    }
    await this.prisma.customDocumentTemplate.delete({ where: { id } });
  }
}
