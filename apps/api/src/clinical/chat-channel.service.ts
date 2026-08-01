import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';

const CHANNEL_ORDER = [{ isGeneral: 'desc' as const }, { name: 'asc' as const }];

// D-048 — every clinic has exactly one "General" channel (auto-created
// lazily here, not backfilled for clinics with no chat history — see the
// migration) plus any number of named team channels any staff member can
// create (no RBAC enforcement anywhere in this app yet, so channel
// creation isn't gated either).
@Injectable()
export class ChatChannelService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async listByClinic(clinicId: string) {
    const channels = await this.prisma.chatChannel.findMany({ where: { clinicId }, orderBy: CHANNEL_ORDER });
    if (channels.length > 0) {
      return channels;
    }
    await this.prisma.chatChannel.create({
      data: { tenantId: currentTenantId(), clinicId, name: 'General', isGeneral: true },
    });
    return this.prisma.chatChannel.findMany({ where: { clinicId }, orderBy: CHANNEL_ORDER });
  }

  // Powers the notification bell's cross-channel unread badge without
  // fetching every channel's full message history — one "latest message"
  // row per channel is enough to know whether anything is newer than the
  // client's per-channel "last seen" marker.
  async listByClinicWithLatestMessage(clinicId: string) {
    const channels = await this.listByClinic(clinicId);
    const latest = await this.prisma.chatMessage.findMany({
      where: { channelId: { in: channels.map((c) => c.id) } },
      orderBy: { createdAt: 'desc' },
      distinct: ['channelId'],
      select: { channelId: true, createdAt: true, staffId: true },
    });
    const latestByChannel = new Map(latest.map((m) => [m.channelId, m]));
    return channels.map((channel) => ({
      ...channel,
      latestMessageAt: latestByChannel.get(channel.id)?.createdAt ?? null,
      latestMessageStaffId: latestByChannel.get(channel.id)?.staffId ?? null,
    }));
  }

  async create(clinicId: string, name: string) {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException('name is required');
    }
    const existing = await this.prisma.chatChannel.findFirst({ where: { clinicId, name: trimmed } });
    if (existing) {
      throw new BadRequestException('A channel with this name already exists');
    }
    return this.prisma.chatChannel.create({
      data: { tenantId: currentTenantId(), clinicId, name: trimmed, isGeneral: false },
    });
  }
}
