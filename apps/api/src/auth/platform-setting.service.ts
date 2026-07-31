import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';

// Platform console (D-037) — key/value settings (General/Billing/
// Notification sections of the owner's System Configurations reference
// screen). LHDN MyInvois fallback credentials belong here too eventually,
// but secret-bearing keys need encryption-at-rest handling that is part of
// the e-Invoice phase (D-032), not this console shell.
@Injectable()
export class PlatformSettingService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.platformSetting.findMany();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async setMany(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.prisma.$transaction(
      Object.entries(settings).map(([key, value]) =>
        this.prisma.platformSetting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue },
          update: { value: value as Prisma.InputJsonValue },
        }),
      ),
    );
    return this.getAll();
  }
}
