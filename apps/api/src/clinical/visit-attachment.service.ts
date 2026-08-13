import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttachmentRecordStatus, VisitAttachmentCategory } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { saveUploadedFile } from '../core/file-storage';
import { assertCanVoidClinicalRecord, snapshotOf } from './clinical-authorization';
import { assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { defaultCategoryFor, validateClinicalAttachment } from './attachment-validation';
import { VoidClinicalRecordDto } from './dto/void-clinical-record.dto';

// D-044 — free-standing visit-level uploads (photos, scanned results,
// PDFs), distinct from Attachment (scoped to a single order/procedure
// result). Same local-disk storage convention as order attachments.
@Injectable()
export class VisitAttachmentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  // G3a (D-062) — ACTIVE only by default; a removed clinical image must not
  // show up in the gallery as if it were current.
  listByVisitId(visitId: string, includeRemoved = false) {
    return this.prisma.visitAttachment.findMany({
      where: {
        visitId,
        ...(includeRemoved ? {} : { recordStatus: AttachmentRecordStatus.ACTIVE }),
      },
      include: { uploadedBy: true, removedBy: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // C0 (D-051) — uploader identity comes from the authenticated session, not
  // from the caller. The browser used to post uploadedByStaffId in the body,
  // which made attribution client-controlled; that parameter is gone.
  //
  // G4.5d3c-3c1 — validated BEFORE anything is written. The allow-list, the
  // extension agreement and the leading-byte signature are all checked while
  // the file is still only a buffer, so a refused upload leaves nothing on
  // disk and no row behind. The stored mimeType and fileName come from the
  // validator, not from the request: what is served back later must be a type
  // this clinic actually accepted, under a name that is safe in a header.
  async create(visitId: string, file: Express.Multer.File) {
    const { mimeType, fileName } = validateClinicalAttachment(file);
    const tenantId = currentTenantId();
    const uploadedByStaffId = currentStaffId() ?? null;
    const stored = await saveUploadedFile(tenantId, visitId, file.buffer, fileName);
    return this.prisma.visitAttachment.create({
      data: {
        tenantId,
        visitId,
        fileName,
        filePath: stored.relativePath,
        mimeType,
        fileSize: file.size,
        uploadedByStaffId,
        // b0 — the file type SUGGESTS a kind, and a suggestion is not
        // attributed: `categorySetBy` stays null until a person actually
        // files it, so "nobody has looked at this yet" stays legible in the
        // record instead of every upload appearing to be somebody's decision.
        category: defaultCategoryFor(mimeType),
      },
    });
  }

  /**
   * b0 — re-file an attachment under a different kind.
   *
   * This is the only way the tag changes after upload, and it records who and
   * when: the tag is what a later reader searches the record by, so a lab
   * result re-tagged as a photo is a change to the record, not to a label.
   * `version` increments like every other attachment mutation, so a stale
   * browser cannot overwrite a newer decision.
   */
  async setCategory(visitId: string, attachmentId: string, category: VisitAttachmentCategory, expectedVersion?: number) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      await assertMayTouchVisit(tx, visitId, actor);

      const attachment = await tx.visitAttachment.findUnique({ where: { id: attachmentId } });
      if (!attachment || attachment.visitId !== visitId) {
        throw new NotFoundException('Attachment not found');
      }
      // A removed file is out of the active record; re-filing it would put a
      // tag on something nobody is looking at and bump its version under the
      // audit trail that removal wrote.
      if (attachment.recordStatus === AttachmentRecordStatus.REMOVED_IN_ERROR) {
        throw new ConflictException('This attachment has been removed from the visit.');
      }
      if (expectedVersion !== undefined && expectedVersion !== attachment.version) {
        throw new ConflictException('This attachment changed since you loaded it. Reload and try again.');
      }

      return tx.visitAttachment.update({
        where: { id: attachmentId },
        data: {
          category,
          categorySetByStaffId: actor.id,
          categorySetAt: new Date(),
          version: { increment: 1 },
        },
      });
    });
  }

  async findOne(visitId: string, attachmentId: string) {
    const attachment = await this.prisma.visitAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.visitId !== visitId) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }

  /**
   * G3a (D-062) — audited removal of a clinical attachment.
   *
   * Replaces the hard delete. Two things survive that previously did not:
   * the database row (so filename, MIME type, uploader and upload time stay
   * on record) and **the file itself** — `deleteUploadedFile` is no longer
   * called, so an authorised history request can still retrieve the otoscope
   * image or scanned report.
   *
   * Physical retention policy is deliberately out of scope: deciding when a
   * clinic may actually purge bytes is a separate explicit policy phase, not
   * something that should ride along on a DELETE request.
   */
  async removeFromVisit(visitId: string, attachmentId: string, dto: VoidClinicalRecordDto) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A reason is required to remove a clinical attachment.');
    }

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanVoidClinicalRecord(actor, 'remove a clinical attachment');
      await assertMayTouchVisit(tx, visitId, actor);

      const attachment = await tx.visitAttachment.findUnique({ where: { id: attachmentId } });
      if (!attachment || attachment.visitId !== visitId) {
        throw new NotFoundException('Attachment not found');
      }
      if (attachment.recordStatus === AttachmentRecordStatus.REMOVED_IN_ERROR) {
        throw new ConflictException('This attachment has already been removed.');
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== attachment.version) {
        throw new ConflictException('This attachment changed since you loaded it. Reload and try again.');
      }

      const snap = snapshotOf(actor);
      return tx.visitAttachment.update({
        where: { id: attachmentId },
        data: {
          recordStatus: AttachmentRecordStatus.REMOVED_IN_ERROR,
          removedAt: new Date(),
          removedByStaffId: snap.staffId,
          removedByNameSnapshot: snap.nameSnapshot,
          removedByRoleSnapshot: snap.roleSnapshot,
          removalReason: reason,
          version: { increment: 1 },
          // filePath, fileName, mimeType, fileSize, uploadedBy* untouched.
        },
      });
    });
  }
}
