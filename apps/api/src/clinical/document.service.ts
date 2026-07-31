import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';

@Injectable()
export class DocumentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly visits: VisitService,
  ) {}

  // issuedByStaffId is a real doctor picker (falls back to the visit's
  // attending physician only as a convenience default) — invoices/
  // documents must be staff-creatable for locum coverage.
  async create(dto: CreateDocumentDto) {
    const visit = await this.visits.findById(dto.visitId);
    return this.prisma.document.create({
      data: {
        tenantId: currentTenantId(),
        visitId: visit.id,
        type: dto.type,
        content: dto.content,
        issuedByStaffId: dto.issuedByStaffId ?? visit.staffId,
        issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        diagnosisText: dto.diagnosisText,
        referredTo: dto.referredTo,
      },
    });
  }

  findByVisitId(visitId: string) {
    return this.prisma.document.findMany({
      where: { visitId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(id: string) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    await this.prisma.document.delete({ where: { id } });
  }

  // Dispensary "prep, sign MC" step — a lightweight sign-off, not a
  // one-way status: re-signing (e.g. correcting who signed) just
  // overwrites signedAt/signedByStaffId rather than being rejected.
  async sign(id: string, dto: SignDocumentDto) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return this.prisma.document.update({
      where: { id },
      data: { signedAt: new Date(), signedByStaffId: dto.staffId },
    });
  }
}
