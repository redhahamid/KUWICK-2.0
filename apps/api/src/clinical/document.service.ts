import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentRecordStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { assertCanVoidClinicalRecord, snapshotOf } from './clinical-authorization';
import { assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { VoidClinicalRecordDto } from './dto/void-clinical-record.dto';

@Injectable()
export class DocumentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
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
        title: dto.title,
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

  // G3a (D-062) — ACTIVE only by default. A voided MC or referral must never
  // appear as a current document; `includeVoided` backs the history view.
  findByVisitId(visitId: string, includeVoided = false) {
    return this.prisma.document.findMany({
      where: {
        visitId,
        ...(includeVoided ? {} : { recordStatus: DocumentRecordStatus.ACTIVE }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * G3a (D-062) — void a clinical document.
   *
   * This replaces the hard delete entirely: there is no longer any application
   * path that deletes a saved document. A signed MC, referral or memo cannot
   * disappear — the row, its content, its issuer and its signature all stay
   * exactly as they were, and only `recordStatus` changes alongside who voided
   * it, when and why. Nothing is regenerated or overwritten.
   *
   * There is deliberately no un-void: reinstating a voided clinical document
   * is a separate decision, not a side effect of this phase.
   */
  async voidDocument(id: string, dto: VoidClinicalRecordDto) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A reason is required to void a document.');
    }

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanVoidClinicalRecord(actor, 'void a clinical document');

      const document = await tx.document.findUnique({ where: { id } });
      if (!document) {
        throw new NotFoundException('Document not found');
      }
      await assertMayTouchVisit(tx, document.visitId, actor);

      if (document.recordStatus === DocumentRecordStatus.VOIDED) {
        throw new ConflictException('This document has already been voided.');
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== document.version) {
        throw new ConflictException('This document changed since you loaded it. Reload and try again.');
      }

      const snap = snapshotOf(actor);
      return tx.document.update({
        where: { id },
        data: {
          recordStatus: DocumentRecordStatus.VOIDED,
          voidedAt: new Date(),
          voidedByStaffId: snap.staffId,
          voidedByNameSnapshot: snap.nameSnapshot,
          voidedByRoleSnapshot: snap.roleSnapshot,
          voidReason: reason,
          version: { increment: 1 },
          // content, issuedBy*, signedAt and signedByStaffId are deliberately
          // NOT touched — the issued document has to survive intact.
        },
      });
    });
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
