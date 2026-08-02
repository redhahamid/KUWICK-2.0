import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentRecordStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { assertCanSignDocument, assertCanVoidClinicalRecord, snapshotOf } from './clinical-authorization';
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
      // G3b — the workspace shows "created by", "signed by" and "voided by"
      // as names. Resolving them here beats making the browser join a
      // separate staff list, which is also how a staff member who has since
      // left ends up rendering as a blank.
      include: { issuedBy: true, signedBy: true, voidedBy: true },
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

  /**
   * The dispensary "prep, sign MC" sign-off — G3b corrected.
   *
   * Three things were wrong, all found by inspecting the lifecycle rather
   * than trusting the UI badge:
   *
   *  1. The signer came from the request body, and the browser sent the
   *     VISIT's attending doctor regardless of who actually clicked. A
   *     document could therefore be attributed to a doctor who never saw it.
   *     Signer identity now comes from the authenticated session only.
   *  2. Anyone who could reach the route could sign. It now requires a
   *     clinical role and branch access to the visit.
   *  3. Re-signing silently overwrote `signedAt`/`signedByStaffId`, so a
   *     signed document could be re-attributed with no trace. That is now a
   *     409.
   *
   * Deliberately NOT changed: who is eligible. `canSignDocument` is the
   * clinical-role test, because this sign-off is a workflow step, not the C0
   * medicolegal signature (see clinical-authorization.ts). Narrowing it here
   * would have broken the existing front-desk/dispensary workflow on the
   * strength of a shared word.
   */
  async sign(id: string, dto: SignDocumentDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanSignDocument(actor);

      const document = await tx.document.findUnique({ where: { id } });
      if (!document) {
        throw new NotFoundException('Document not found');
      }
      await assertMayTouchVisit(tx, document.visitId, actor);

      if (document.recordStatus === DocumentRecordStatus.VOIDED) {
        throw new ConflictException('This document has been voided and cannot be signed.');
      }
      if (document.signedAt) {
        throw new ConflictException(
          'This document is already signed. A signed document cannot be re-signed or re-attributed.',
        );
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== document.version) {
        throw new ConflictException('This document changed since you loaded it. Reload and try again.');
      }

      return tx.document.update({
        where: { id },
        data: {
          signedAt: new Date(),
          signedByStaffId: actor.id,
          version: { increment: 1 },
          // content is never touched — there is no route that edits it.
        },
      });
    });
  }
}
