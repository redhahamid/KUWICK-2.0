import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { DocumentService } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { VoidClinicalRecordDto } from './dto/void-clinical-record.dto';

// G3a (D-062) — scoped pipe: a client that posts voidedByStaffId must fail
// loudly with 400 rather than have it silently stripped.
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('documents')
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  findByVisit(@Query('visitId') visitId: string) {
    return this.documents.findByVisitId(visitId);
  }

  @Post()
  create(@Body() dto: CreateDocumentDto) {
    return this.documents.create(dto);
  }

  // G3b closure (D-064) — renamed from /sign. The old name was the defect:
  // it described a doctor accepting clinical responsibility and a front-desk
  // hand-over check with the same word, and the route enforced neither.
  @Patch(':id/authorise')
  authorise(@Param('id') id: string, @Body() dto: SignDocumentDto) {
    return this.documents.authorise(id, dto);
  }

  // G3a (D-062) — the audit view: every document ever issued for the visit,
  // including voided ones with their actor, time and reason.
  @Get('history')
  history(@Query('visitId') visitId: string) {
    return this.documents.findByVisitId(visitId, true);
  }

  // G3a (D-062) — replaces DELETE /documents/:id entirely. A saved clinical
  // document is voided with a mandatory reason; the content and signature
  // survive.
  @Patch(':id/void')
  voidDocument(@Param('id') id: string, @Body() dto: VoidClinicalRecordDto) {
    return this.documents.voidDocument(id, dto);
  }
}
