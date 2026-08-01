import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';

const STAFF_SELECT = { id: true, fullName: true } as const;

// D-046 — one thread model backs two surfaces: the clinic-wide chat box
// (orderServiceId null, clinicId is the channel) and per-procedure chat
// (orderServiceId set). Polling-based, same convention as the Queue's 10s
// refetchInterval — no WebSocket infrastructure in this environment.
@Injectable()
export class ChatService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  private requireStaffId(): string {
    const staffId = currentStaffId();
    if (!staffId) {
      throw new BadRequestException('No authenticated staff member for this request');
    }
    return staffId;
  }

  private requireMessage(message: string): string {
    const trimmed = message?.trim();
    if (!trimmed) {
      throw new BadRequestException('message is required');
    }
    return trimmed;
  }

  listChannel(channelId: string) {
    return this.prisma.chatMessage.findMany({
      where: { channelId },
      include: { staff: { select: STAFF_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createInChannel(channelId: string, message: string) {
    const channel = await this.prisma.chatChannel.findUnique({ where: { id: channelId }, select: { clinicId: true } });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return this.prisma.chatMessage.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: channel.clinicId,
        channelId,
        staffId: this.requireStaffId(),
        message: this.requireMessage(message),
      },
      include: { staff: { select: STAFF_SELECT } },
    });
  }

  listForOrder(orderServiceId: string) {
    return this.prisma.chatMessage.findMany({
      where: { orderServiceId },
      include: { staff: { select: STAFF_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createForOrder(orderServiceId: string, message: string) {
    const order = await this.prisma.orderService.findUnique({ where: { id: orderServiceId }, select: { clinicId: true } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.prisma.chatMessage.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: order.clinicId,
        orderServiceId,
        staffId: this.requireStaffId(),
        message: this.requireMessage(message),
      },
      include: { staff: { select: STAFF_SELECT } },
    });
  }
}
