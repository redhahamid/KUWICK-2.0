import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

// HR, Phase 1c. Simple request → approve/reject workflow — no accrual
// balances or leave-type quotas yet (out of MVP scope per
// PRODUCT_REQUIREMENTS.md §14's "leave request and approval workflow"
// wording, not a richer balance-tracking system).
@Injectable()
export class LeaveRequestService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

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

  /**
   * DECIDE A LEAVE REQUEST — as whoever is signed in.
   *
   * Both halves of this used to take the approver's id FROM THE REQUEST BODY
   * and write it down as fact, with no permission check and no audit row. Any
   * caller could approve any request in anybody's name. Approving leave costs
   * money (unpaid leave reaches payroll) and moves the roster, so it is now
   * `hr.leave.approve`, the actor is the session's, and the decision is
   * audited like every other one in this product.
   */
  private async decide(id: string, status: LeaveStatus, rejectReason?: string) {
    return withAdminTx(this.rawPrisma, 'hr.leave.approve', async (tx, actor) => {
      const request = await tx.leaveRequest.findUnique({ where: { id }, include: { staff: true } });
      if (!request) throw new NotFoundException('Leave request not found');
      if (request.status !== LeaveStatus.PENDING) {
        throw new BadRequestException(
          `This request was already ${request.status.toLowerCase()}. Only a waiting request can be decided.`,
        );
      }
      // NOBODY DECIDES THEIR OWN, the same rule overtime and claims follow.
      if (request.staffId === actor.id) {
        throw new BadRequestException('You cannot decide your own leave request.');
      }

      const saved = await tx.leaveRequest.update({
        where: { id },
        data: {
          status,
          approvedByStaffId: actor.id,
          approvedAt: new Date(),
          ...(status === LeaveStatus.REJECTED ? { rejectReason } : {}),
        },
      });

      await recordAudit(tx, actor, {
        // The vocabulary that already exists for this — see workforce/leave.service.ts.
        action: 'leave.decided',
        entityType: 'LeaveRequest',
        entityId: id,
        before: { status: request.status },
        after: {
          status,
          staff: request.staff.fullName,
          leaveType: request.leaveType,
          from: request.startDate.toISOString().slice(0, 10),
          to: request.endDate.toISOString().slice(0, 10),
          ...(rejectReason ? { rejectReason } : {}),
        },
        reason: rejectReason,
        source: 'hr.leave',
      });

      return saved;
    });
  }

  approve(id: string, _dto: DecideLeaveRequestDto) {
    return this.decide(id, LeaveStatus.APPROVED);
  }

  reject(id: string, dto: DecideLeaveRequestDto) {
    return this.decide(id, LeaveStatus.REJECTED, dto.rejectReason);
  }
}
