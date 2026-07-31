import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

// HR, Phase 1c. Simple request → approve/reject workflow — no accrual
// balances or leave-type quotas yet (out of MVP scope per
// PRODUCT_REQUIREMENTS.md §14's "leave request and approval workflow"
// wording, not a richer balance-tracking system).
@Injectable()
export class LeaveRequestService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  create(dto: CreateLeaveRequestDto) {
    return this.prisma.leaveRequest.create({
      data: {
        tenantId: currentTenantId(),
        staffId: dto.staffId,
        leaveType: dto.leaveType,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: dto.reason,
      },
    });
  }

  findAll(staffId?: string, status?: LeaveStatus) {
    return this.prisma.leaveRequest.findMany({
      where: { staffId, status },
      include: { staff: true, approvedBy: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { staff: true, approvedBy: true },
    });
    if (!request) {
      throw new NotFoundException('Leave request not found');
    }
    return request;
  }

  async approve(id: string, dto: DecideLeaveRequestDto) {
    const request = await this.findById(id);
    if (request.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(`Cannot approve a leave request in status ${request.status}`);
    }
    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveStatus.APPROVED,
        approvedByStaffId: dto.approvedByStaffId,
        approvedAt: new Date(),
      },
    });
  }

  async reject(id: string, dto: DecideLeaveRequestDto) {
    const request = await this.findById(id);
    if (request.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(`Cannot reject a leave request in status ${request.status}`);
    }
    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveStatus.REJECTED,
        approvedByStaffId: dto.approvedByStaffId,
        approvedAt: new Date(),
        rejectReason: dto.rejectReason,
      },
    });
  }
}
