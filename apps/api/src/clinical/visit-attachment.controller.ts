import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { readUploadedFileStream } from '../core/file-storage';
import { VisitAttachmentService } from './visit-attachment.service';
import { VoidClinicalRecordDto } from './dto/void-clinical-record.dto';
import { SetAttachmentCategoryDto } from './dto/set-attachment-category.dto';

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

@Controller('visits/:visitId/attachments')
export class VisitAttachmentController {
  constructor(private readonly attachments: VisitAttachmentService) {}

  @Get()
  list(@Param('visitId') visitId: string) {
    return this.attachments.listByVisitId(visitId);
  }

  // C0 (D-051) — uploadedByStaffId is NO LONGER accepted from the request
  // body. The browser previously supplied it, which meant uploader identity
  // was client-controlled; it is now derived from the authenticated session
  // inside the service, same rule as clinical-note authorship.
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  upload(@Param('visitId') visitId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.attachments.create(visitId, file);
  }

  @Get(':attachmentId/download')
  async download(@Param('visitId') visitId: string, @Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const attachment = await this.attachments.findOne(visitId, attachmentId);
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    });
    readUploadedFileStream(attachment.filePath).pipe(res);
  }

  // G3a (D-062) — audit view: every attachment ever uploaded to the visit,
  // including removed ones. The FILE is still on disk, so the download route
  // keeps working for authorised history.
  @Get('history')
  history(@Param('visitId') visitId: string) {
    return this.attachments.listByVisitId(visitId, true);
  }

  // b0 — re-file an attachment as photo | lab | letter. Its own route rather
  // than a general PATCH: this is the only field of an attachment that is
  // meant to change after upload, and the endpoint should not be able to
  // become a way to edit a filename or a MIME type later.
  @Patch(':attachmentId/category')
  setCategory(
    @Param('visitId') visitId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: SetAttachmentCategoryDto,
  ) {
    return this.attachments.setCategory(visitId, attachmentId, dto.category, dto.expectedVersion);
  }

  // G3a (D-062) — replaces DELETE. Audited removal with a mandatory reason;
  // the clinical image is never unlinked from storage.
  @Patch(':attachmentId/removal')
  remove(
    @Param('visitId') visitId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: VoidClinicalRecordDto,
  ) {
    return this.attachments.removeFromVisit(visitId, attachmentId, dto);
  }
}
