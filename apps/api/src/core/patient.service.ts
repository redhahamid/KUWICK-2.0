import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from './tenant-scoped-prisma.provider';
import { currentTenantId } from './tenant-context';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Injectable()
export class PatientService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreatePatientDto) {
    return this.prisma.patient.create({
      data: {
        tenantId: currentTenantId(),
        identifierType: dto.identifierType,
        identifierValue: dto.identifierValue,
        name: dto.name,
        dob: dto.dob ? new Date(dto.dob) : undefined,
        gender: dto.gender,
        race: dto.race,
        phone: dto.phone,
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        allergies: dto.allergies,
      },
    });
  }

  // "Enter patient name, NRIC or phone number" — the combined search field
  // pattern from the audited Add Appointment wizard's Patient step.
  findAll(search?: string) {
    return this.prisma.patient.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { identifierValue: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient || patient.deletedAt) {
      throw new NotFoundException('Patient not found');
    }
    return patient;
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.findById(id);
    return this.prisma.patient.update({
      where: { id },
      data: {
        ...dto,
        dob: dto.dob ? new Date(dto.dob) : undefined,
      },
    });
  }

  // Soft delete (Patient.deletedAt) — visits/invoices/documents reference
  // patients by FK, so a hard delete would either cascade-destroy clinical
  // history or fail outright; deactivating keeps the record intact for any
  // existing visit while removing it from the active Patients list.
  async remove(id: string) {
    await this.findById(id);
    return this.prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
