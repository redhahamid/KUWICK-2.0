import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

// Queue overhaul (D-038) — the physical stations a patient can be called
// to (Consultation 1/2, Treatment Room 1/2, Dispensary Counter).
@Injectable()
export class RoomService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  create(dto: CreateRoomDto) {
    return this.prisma.room.create({ data: { ...dto, tenantId: currentTenantId() } });
  }

  findAll(clinicId?: string, activeOnly = false) {
    return this.prisma.room.findMany({
      where: { clinicId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, dto: UpdateRoomDto) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return this.prisma.room.update({ where: { id }, data: dto });
  }
}
