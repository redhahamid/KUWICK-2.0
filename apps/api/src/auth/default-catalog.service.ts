import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { CreateDefaultPanelClinicDto } from './dto/create-default-panel-clinic.dto';
import { UpdateDefaultPanelClinicDto } from './dto/update-default-panel-clinic.dto';
import { CreateDefaultProcedureDto } from './dto/create-default-procedure.dto';
import { UpdateDefaultProcedureDto } from './dto/update-default-procedure.dto';

// Platform console (D-037) — global default catalogs the owner curates
// once; copied into each new tenant at creation time by
// PlatformTenantService.create. No RLS on these tables (like
// platform_admins), so plain PrismaService needs no GUC dance.
@Injectable()
export class DefaultCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listPanelClinics() {
    return this.prisma.defaultPanelClinic.findMany({ orderBy: { name: 'asc' } });
  }

  createPanelClinic(dto: CreateDefaultPanelClinicDto) {
    return this.prisma.defaultPanelClinic.create({ data: dto });
  }

  async updatePanelClinic(id: string, dto: UpdateDefaultPanelClinicDto) {
    const existing = await this.prisma.defaultPanelClinic.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Default panel clinic not found');
    }
    return this.prisma.defaultPanelClinic.update({ where: { id }, data: dto });
  }

  async removePanelClinic(id: string) {
    const existing = await this.prisma.defaultPanelClinic.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Default panel clinic not found');
    }
    await this.prisma.defaultPanelClinic.delete({ where: { id } });
  }

  listProcedures() {
    return this.prisma.defaultProcedure.findMany({ orderBy: { name: 'asc' } });
  }

  listDocumentTemplates() {
    return this.prisma.defaultDocumentTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  createDocumentTemplate(dto: { name: string; content: string; active?: boolean }) {
    return this.prisma.defaultDocumentTemplate.create({ data: dto });
  }

  async updateDocumentTemplate(id: string, dto: { name?: string; content?: string; active?: boolean }) {
    const existing = await this.prisma.defaultDocumentTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Default document template not found');
    }
    return this.prisma.defaultDocumentTemplate.update({ where: { id }, data: dto });
  }

  async removeDocumentTemplate(id: string) {
    const existing = await this.prisma.defaultDocumentTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Default document template not found');
    }
    await this.prisma.defaultDocumentTemplate.delete({ where: { id } });
  }

  createProcedure(dto: CreateDefaultProcedureDto) {
    return this.prisma.defaultProcedure.create({ data: dto });
  }

  async updateProcedure(id: string, dto: UpdateDefaultProcedureDto) {
    const existing = await this.prisma.defaultProcedure.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Default procedure not found');
    }
    return this.prisma.defaultProcedure.update({ where: { id }, data: dto });
  }

  async removeProcedure(id: string) {
    const existing = await this.prisma.defaultProcedure.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Default procedure not found');
    }
    await this.prisma.defaultProcedure.delete({ where: { id } });
  }
}
