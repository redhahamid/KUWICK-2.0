import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { deleteUploadedFile, saveUploadedFile } from '../core/file-storage';

// D-044 — free-standing visit-level uploads (photos, scanned results,
// PDFs), distinct from Attachment (scoped to a single order/procedure
// result). Same local-disk storage convention as order attachments.
@Injectable()
export class VisitAttachmentService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  listByVisitId(visitId: string) {
    return this.prisma.visitAttachment.findMany({
      where: { visitId },
      include: { uploadedBy: true },
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

  async remove(visitId: string, attachmentId: string) {
    const attachment = await this.findOne(visitId, attachmentId);
    await this.prisma.visitAttachment.delete({ where: { id: attachmentId } });
    await deleteUploadedFile(attachment.filePath);
  }
}
