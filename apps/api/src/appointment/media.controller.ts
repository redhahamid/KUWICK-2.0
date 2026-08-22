import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { MAX_MEDIA_BYTES, MediaService } from './media.service';

/**
 * PHASE 6 — staff-side media management for the public booking surface.
 * Upload and delete require the CONFIGURE permission (asserted in the
 * service); the read here is the AUTHENTICATED admin preview — the public
 * page serves images through /public/booking/:slug/media/:id instead, under
 * the slug's own tenant bootstrap.
 */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_MEDIA_BYTES } }),
  )
  upload(@Query('kind') kind?: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    return this.media.upload(kind ?? '', file);
  }

  @Get(':id')
  async read(@Param('id') id: string, @Res() res: Response) {
    const row = await this.media.read(id);
    res.set({
      'Content-Type': row.contentType,
      // Id-addressed and immutable: replacing an image mints a new id, so
      // this can cache hard without ever serving a stale picture.
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.send(Buffer.from(row.data));
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.media.remove(id);
  }
}
