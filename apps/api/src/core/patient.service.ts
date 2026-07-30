import { Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from './tenant-scoped-prisma.provider';
import { currentTenantId } from './tenant-context';
import { CreatePatientDto } from './dto/create-patient.dto';

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
        address: dto.address,
        emergencyContact: dto.emergencyContact,
      },
    });
  }

  findAll() {
    return this.prisma.patient.findMany({ orderBy: { name: 'asc' } });
  }
}
