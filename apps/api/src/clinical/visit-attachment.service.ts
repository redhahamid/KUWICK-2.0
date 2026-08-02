import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttachmentRecordStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { saveUploadedFile } from '../core/file-storage';
import { assertCanVoidClinicalRecord, snapshotOf } from './clinical-authorization';
import { assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
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
  async create(visitId: string, file: Express.Multer.File) {
    const tenantId = currentTenantId();
    const uploadedByStaffId = currentStaffId() ?? null;
    const stored = await saveUploadedFile(tenantId, visitId, file.buffer, file.originalname);
    return this.prisma.visitAttachment.create({
      data: {
        tenantId,
        visitId,
        fileName: file.originalname,
        filePath: stored.relativePath,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedByStaffId,
      },
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
