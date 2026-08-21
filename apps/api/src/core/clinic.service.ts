import { Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from './tenant-scoped-prisma.provider';
import { currentTenantId } from './tenant-context';
import { CreateClinicDto, UpdateClinicDto } from './dto/create-clinic.dto';

@Injectable()
export class ClinicService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateClinicDto) {
    return this.prisma.clinic.create({ data: { ...dto, tenantId: currentTenantId() } });
  }

  /**
   * Every clinic, each carrying its PATIENT-FACING name.
   *
   * The clinic row's `name` is the operational identity — on a staging
   * database it reads "Klinik UAT Staging (Synthetic)", and even in
   * production it may be a registration name no patient ever sees. What a
   * patient should read is what the clinic wrote on its public booking page
   * (`ClinicBookingPage.displayName`), falling back to the clinic name when
   * no page exists.
   *
   * Resolved HERE, once, because this list is the one clinic surface every
   * signed-in role can read: WhatsApp messages, confirmations and any future
   * template all take `patientFacingName` from it instead of each surface
   * choosing its own answer — which is how the calendar drawer and the
   * appointment list came to greet the same patient with two different
   * clinics (one of them blank).
   */
  async findAll() {
    const clinics = await this.prisma.clinic.findMany({
      orderBy: { name: 'asc' },
      include: { bookingPage: { select: { displayName: true } } },
    });
    return clinics.map(({ bookingPage, ...clinic }) => ({
      ...clinic,
      patientFacingName: bookingPage?.displayName?.trim() || clinic.name,
    }));
  }

  update(id: string, dto: UpdateClinicDto) {
    return this.prisma.clinic.update({ where: { id }, data: dto });
  }
}
