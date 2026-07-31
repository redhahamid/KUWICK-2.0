import { Injectable, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';

// Queue overhaul (D-038) — the waiting-room TV's data source. Deliberately
// unauthenticated (a TV can't log in) and outside TenantContextMiddleware;
// the clinic id in the URL is an unguessable UUID. One bootstrap read
// resolves the clinic's tenantId under app.bypass_tenant_scope (the same
// narrow escape hatch as login's tenant-by-slug, D-036, extended to the
// clinics policy in migration 20260731310000); every subsequent query runs
// under that tenant's ordinary app.tenant_id RLS scope. The payload
// exposes queue numbers and room names only — never patient names or any
// other PII, since anyone with the URL can read it.
@Injectable()
export class PublicQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async getMonitorData(clinicId: string) {
    const clinic = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return tx.clinic.findUnique({ where: { id: clinicId } });
    });
    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const { tickets, config } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${clinic.tenantId}, true)`;
      const [ticketRows, configRow] = await Promise.all([
        tx.queueTicket.findMany({
          where: {
            clinicId,
            createdAt: { gte: startOfDay },
            status: { in: [QueueTicketStatus.WAITING, QueueTicketStatus.IN_CONSULTATION, QueueTicketStatus.DISPENSARY_PAYMENT] },
          },
          include: { room: true },
          orderBy: { createdAt: 'asc' },
        }),
        tx.queueDisplayConfig.findUnique({ where: { clinicId } }),
      ]);
      return { tickets: ticketRows, config: configRow };
    });

    return {
      clinic: { id: clinic.id, name: clinic.name },
      config: {
        youtubeUrl: config?.youtubeUrl ?? null,
        runningText: config?.runningText ?? null,
        voiceName: config?.voiceName ?? null,
        voiceRate: config?.voiceRate ?? 1,
        voicePitch: config?.voicePitch ?? 1,
        voiceVolume: config?.voiceVolume ?? 1,
      },
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        displayNumber: ticket.displayNumber ?? `#${ticket.ticketNumber}`,
        queueType: ticket.queueType,
        status: ticket.status,
        calledAt: ticket.calledAt,
        roomName: ticket.room?.name ?? null,
      })),
    };
  }
}
