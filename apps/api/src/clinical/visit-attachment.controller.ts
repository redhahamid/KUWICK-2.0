import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { readUploadedFileStream } from '../core/file-storage';
import { VisitAttachmentService } from './visit-attachment.service';

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

  @Delete(':attachmentId')
  @HttpCode(204)
  remove(@Param('visitId') visitId: string, @Param('attachmentId') attachmentId: string) {
    return this.attachments.remove(visitId, attachmentId);
  }
}
