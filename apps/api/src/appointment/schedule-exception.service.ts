import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateScheduleExceptionDto } from './dto/create-schedule-exception.dto';
import { parseDateOnly, parseTimeToDate } from './time.util';

@Injectable()
export class ScheduleExceptionService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateScheduleExceptionDto) {
    return this.prisma.scheduleException.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: dto.clinicId,
        staffId: dto.staffId,
        date: parseDateOnly(dto.date),
        startTime: dto.startTime ? parseTimeToDate(dto.startTime) : null,
        endTime: dto.endTime ? parseTimeToDate(dto.endTime) : null,
        reason: dto.reason,
      },
    });
  }

  findAll(filter: { staffId?: string; clinicId?: string; from?: string; to?: string }) {
    return this.prisma.scheduleException.findMany({
      where: {
        staffId: filter.staffId,
        clinicId: filter.clinicId,
        date:
          filter.from || filter.to
            ? {
                gte: filter.from ? parseDateOnly(filter.from) : undefined,
                lte: filter.to ? parseDateOnly(filter.to) : undefined,
              }
            : undefined,
      },
      orderBy: { date: 'asc' },
    });
  }

  async remove(id: string) {
    const exception = await this.prisma.scheduleException.findUnique({ where: { id } });
    if (!exception) {
      throw new NotFoundException('Schedule exception not found');
    }
    await this.prisma.scheduleException.delete({ where: { id } });
  }
}
