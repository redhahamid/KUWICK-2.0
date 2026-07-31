import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';

// HR, Phase 1c. Tenant-wide calendar (not per-clinic) — feeds the future
// holiday/after-hours surcharge engine once that's scoped (D-030); the
// calendar itself is unblocked today.
@Injectable()
export class PublicHolidayService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  create(dto: CreatePublicHolidayDto) {
    return this.prisma.publicHoliday.create({
      data: { tenantId: currentTenantId(), date: new Date(dto.date), name: dto.name },
    });
  }

  findAll() {
    return this.prisma.publicHoliday.findMany({ orderBy: { date: 'asc' } });
  }

  async remove(id: string) {
    const holiday = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!holiday) {
      throw new NotFoundException('Public holiday not found');
    }
    await this.prisma.publicHoliday.delete({ where: { id } });
  }
}
