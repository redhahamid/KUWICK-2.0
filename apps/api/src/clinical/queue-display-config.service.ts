import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { UpdateQueueDisplayConfigDto } from './dto/update-queue-display-config.dto';

// Queue overhaul (D-038) — per-clinic waiting-room monitor settings.
// Lazily created: reading a clinic with no config yet returns defaults
// without writing a row; the first save upserts it.
@Injectable()
export class QueueDisplayConfigService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async get(clinicId: string) {
    const config = await this.prisma.queueDisplayConfig.findUnique({ where: { clinicId } });
    return (
      config ?? {
        clinicId,
        youtubeUrl: null,
        runningText: null,
        voiceName: null,
        voiceRate: 1,
        voicePitch: 1,
        voiceVolume: 1,
      }
    );
  }

  upsert(clinicId: string, dto: UpdateQueueDisplayConfigDto) {
    return this.prisma.queueDisplayConfig.upsert({
      where: { clinicId },
      create: { tenantId: currentTenantId(), clinicId, ...dto },
      update: dto,
    });
  }
}
