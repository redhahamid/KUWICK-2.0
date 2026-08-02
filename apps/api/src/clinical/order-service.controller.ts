import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { readUploadedFileStream } from '../core/file-storage';
import { OrderServiceService } from './order-service.service';
import { CreateOrderServiceDto } from './dto/create-order-service.dto';
import { CompleteOrderServiceDto } from './dto/complete-order-service.dto';
import { CancelOrderServiceDto } from './dto/cancel-order-service.dto';
import { VoidClinicalRecordDto } from './dto/void-clinical-record.dto';

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

@Controller('order-services')
export class OrderServiceController {
  constructor(private readonly orderServices: OrderServiceService) {}

  @Get()
  findByVisit(
    @Query('visitId') visitId: string,
    @Query('orderType') orderType?: ServiceOrderType,
    @Query('status') status?: OrderServiceStatus,
  ) {
    return this.orderServices.findByVisitId(visitId, { orderType, status });
  }

  @Post()
  create(@Body() dto: CreateOrderServiceDto) {
    return this.orderServices.create(dto);
  }

  // Backs the print-result view (single order, with visit/patient/clinic/
  // requestedBy joined) — separate from the visitId-scoped list above.
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.orderServices.findById(id);
  }

  @Patch(':id/start')
  start(@Param('id') id: string) {
    return this.orderServices.start(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteOrderServiceDto) {
    return this.orderServices.complete(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelOrderServiceDto) {
    return this.orderServices.cancel(id, dto);
  }

  @Get(':id/attachments')
  listAttachments(@Param('id') id: string) {
    return this.orderServices.listAttachments(id);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  uploadAttachment(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.orderServices.addAttachment(id, file);
  }

  @Get(':id/attachments/:attachmentId/download')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const attachment = await this.orderServices.findAttachment(id, attachmentId);
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    });
    readUploadedFileStream(attachment.filePath).pipe(res);
  }

  // G3a (D-062) — audit view for investigation/procedure results.
  @Get(':id/attachments/history')
  attachmentHistory(@Param('id') id: string) {
    return this.orderServices.listAttachments(id, true);
  }

  // G3a (D-062) — replaces DELETE. The result row, the order relationship and
  // the file all survive; only the status changes.
  @Patch(':id/attachments/:attachmentId/removal')
  removeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: VoidClinicalRecordDto,
  ) {
    return this.orderServices.removeAttachment(id, attachmentId, dto);
  }
}
