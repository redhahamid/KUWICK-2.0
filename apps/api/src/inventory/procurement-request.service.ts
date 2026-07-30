import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ProcurementRequestStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateProcurementRequestDto } from './dto/create-procurement-request.dto';

export interface FindProcurementRequestsFilter {
  clinicId?: string;
  status?: ProcurementRequestStatus;
}

@Injectable()
export class ProcurementRequestService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  create(dto: CreateProcurementRequestDto) {
    return this.prisma.procurementRequest.create({
      data: { ...dto, tenantId: currentTenantId(), status: ProcurementRequestStatus.PENDING },
    });
  }

  findAll(filter: FindProcurementRequestsFilter) {
    return this.prisma.procurementRequest.findMany({
      where: { clinicId: filter.clinicId, status: filter.status },
      include: { item: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const request = await this.prisma.procurementRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Procurement request not found');
    }
    return request;
  }

  async approve(id: string) {
    const request = await this.findById(id);
    assertStatus(request.status, 'approve');
    return this.prisma.procurementRequest.update({
      where: { id },
      data: { status: ProcurementRequestStatus.APPROVED },
    });
  }

  async reject(id: string) {
    const request = await this.findById(id);
    assertStatus(request.status, 'reject');
    return this.prisma.procurementRequest.update({
      where: { id },
      data: { status: ProcurementRequestStatus.REJECTED },
    });
  }
}

function assertStatus(current: ProcurementRequestStatus, action: string): void {
  if (current !== ProcurementRequestStatus.PENDING) {
    throw new BadRequestException(`Cannot ${action} a procurement request in status ${current}`);
  }
}
