import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { parseDateOnly, parseTimeToDate } from './time.util';

@Injectable()
export class DoctorScheduleService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateDoctorScheduleDto) {
    return this.prisma.doctorSchedule.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: dto.clinicId,
        staffId: dto.staffId,
        dayOfWeek: dto.dayOfWeek,
        startTime: parseTimeToDate(dto.startTime),
        endTime: parseTimeToDate(dto.endTime),
        effectiveFrom: parseDateOnly(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
      },
    });
  }

  findAll(filter: { staffId?: string; clinicId?: string }) {
    return this.prisma.doctorSchedule.findMany({
      where: { staffId: filter.staffId, clinicId: filter.clinicId },
      orderBy: [{ staffId: 'asc' }, { dayOfWeek: 'asc' }],
    });
  }

  async update(id: string, dto: UpdateDoctorScheduleDto) {
    await this.assertExists(id);
    return this.prisma.doctorSchedule.update({
      where: { id },
      data: { effectiveTo: parseDateOnly(dto.effectiveTo) },
    });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.doctorSchedule.delete({ where: { id } });
  }

  private async assertExists(id: string) {
    const schedule = await this.prisma.doctorSchedule.findUnique({ where: { id } });
    if (!schedule) {
      throw new NotFoundException('Doctor schedule not found');
    }
    return schedule;
  }
}
