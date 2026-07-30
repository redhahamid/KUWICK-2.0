import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';

export interface CreateVisitInput {
  clinicId: string;
  patientId: string;
  staffId: string;
  billingType: string;
  presentingComplaint?: string;
}

export interface FindVisitsFilter {
  clinicId?: string;
  patientId?: string;
}

@Injectable()
export class VisitService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  // Count-based sequence ("V-000002"), not a DB sequence — accepted gap,
  // see the Visit model comment in schema.prisma.
  private async nextVisitNumber(): Promise<string> {
    const count = await this.prisma.visit.count();
    return `V-${String(count + 1).padStart(6, '0')}`;
  }

  async create(input: CreateVisitInput) {
    return this.prisma.visit.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: input.clinicId,
        patientId: input.patientId,
        staffId: input.staffId,
        billingType: input.billingType,
        presentingComplaint: input.presentingComplaint,
        visitNumber: await this.nextVisitNumber(),
      },
    });
  }

  findAll(filter: FindVisitsFilter) {
    return this.prisma.visit.findMany({
      where: { clinicId: filter.clinicId, patientId: filter.patientId },
      include: { staff: true, queueTicket: true },
      orderBy: { checkInAt: 'desc' },
    });
  }

  async findById(id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: { staff: true, patient: true, queueTicket: true },
    });
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }
    return visit;
  }

  async checkOut(id: string) {
    await this.findById(id);
    return this.prisma.visit.update({ where: { id }, data: { checkOutAt: new Date() } });
  }
}
