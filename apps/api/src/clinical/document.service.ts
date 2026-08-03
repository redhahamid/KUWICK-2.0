import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentAuthorisationKind, DocumentRecordStatus, DocumentType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { assertCanAuthoriseDocument, assertCanVoidClinicalRecord, snapshotOf } from './clinical-authorization';
import { assertMayTouchVisit, requireActor, requireCreator, withTenantTx } from './clinical-actor';
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

  // issuedByStaffId is the CREATOR, taken from the session (D-085). It was
  // once a client-supplied picker defaulting to the visit's attending doctor;
  // both halves of that are gone.
  /**
   * G3b closure (D-064) — does a document of this shape carry a doctor's
   * clinical opinion?
   *
   * Decided from the stored TYPE, never from the document's text. The four
   * built-in types are all clinical: an MC and a quarantine letter are
   * medical directives, a referral is a clinical hand-over, and MEMO exists
   * in this system as the clinical memo the templates generate. A CUSTOM
   * document takes its template's explicit setting, and a template that
   * cannot be found is treated as clinical — an unclassifiable document is
   * the one you least want front desk authorising.
   */
  private async requiresClinicalAuthorisation(dto: CreateDocumentDto): Promise<boolean> {
    if (dto.type !== DocumentType.CUSTOM) {
      return true;
    }
    if (!dto.title) {
      return true;
    }
    const template = await this.prisma.customDocumentTemplate.findFirst({
      where: { name: dto.title },
      select: { requiresClinicalAuthorisation: true },
    });
    return template?.requiresClinicalAuthorisation ?? true;
  }

  async create(dto: CreateDocumentDto) {
    const visit = await this.visits.findById(dto.visitId);
    return this.prisma.document.create({
      data: {
        tenantId: currentTenantId(),
        visitId: visit.id,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        // Frozen at creation: editing the template later must never change
        // what an already-issued document required.
        requiresClinicalAuthorisation: await this.requiresClinicalAuthorisation(dto),
        // G4.5d3c-1c (D-085) — this is the CREATOR, not the clinical author.
        //
        // Two things were wrong here. It fell back to the visit's attending
        // doctor, so a draft typed by front desk was stamped with Dr A's
        // name; and it accepted `dto.issuedByStaffId` from the browser, so a
        // caller could name anyone at all. Both are silent "on behalf of"
        // attribution, which a clinical record must never do.
        //
        // Front desk MAY create a draft — that is an approved part of the
        // document workflow — and is recorded honestly as its creator. The
        // clinical claim is made separately at authorisation, by a doctor,
        // with its own frozen identity snapshot (D-064).
        issuedByStaffId: requireCreator(),
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
   * Clinically authorise (or, for administrative documents, issue) a
   * document — G3b closure (D-064).
   *
   * G3b made the signer server-derived and stopped silent re-signing. What it
   * did NOT establish is what the signature claims, and it let front desk
   * sign a medical certificate. Two corrections here:
   *
   *  - **Authority now depends on the document.** A document that carries a
   *    doctor's clinical opinion may only be authorised by a doctor. An
   *    administrative document keeps the existing staff permission.
   *  - **The record says which happened.** `authorisationKind` distinguishes
   *    a doctor's CLINICAL authorisation from ADMINISTRATIVE issuance, so no
   *    UI has to guess, and a pre-closure row stays LEGACY_SIGN_OFF rather
   *    than being dressed up as either.
   *
   * Everything G3b established is preserved: identity from the session,
   * branch access checked, re-authorisation 409, content untouched, and no
   * un-authorise path.
   */
  async authorise(id: string, dto: SignDocumentDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);

      const document = await tx.document.findUnique({ where: { id } });
      if (!document) {
        throw new NotFoundException('Document not found');
      }
      await assertMayTouchVisit(tx, document.visitId, actor);

      // Authority is checked against what THIS document requires, read from
      // the row rather than re-derived, so a template edited after the
      // document was issued cannot change who may authorise it.
      assertCanAuthoriseDocument(actor, document.requiresClinicalAuthorisation);

      if (document.recordStatus === DocumentRecordStatus.VOIDED) {
        throw new ConflictException('This document has been voided and cannot be authorised.');
      }
      if (document.signedAt) {
        throw new ConflictException(
          'This document is already authorised. It cannot be re-authorised or re-attributed.',
        );
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== document.version) {
        throw new ConflictException('This document changed since you loaded it. Reload and try again.');
      }

      const snap = snapshotOf(actor);
      return tx.document.update({
        where: { id },
        data: {
          signedAt: new Date(),
          signedByStaffId: actor.id,
          authorisationKind: document.requiresClinicalAuthorisation
            ? DocumentAuthorisationKind.CLINICAL
            : DocumentAuthorisationKind.ADMINISTRATIVE,
          authorisedByNameSnapshot: snap.nameSnapshot,
          authorisedByRoleSnapshot: snap.roleSnapshot,
          authorisedByDesignationSnapshot: snap.designationSnapshot,
          version: { increment: 1 },
          // content is never touched — there is no route that edits it.
        },
      });
    });
  }
}
