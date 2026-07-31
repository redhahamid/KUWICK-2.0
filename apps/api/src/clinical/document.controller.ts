import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { DocumentService } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';

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

  @Patch(':id/sign')
  sign(@Param('id') id: string, @Body() dto: SignDocumentDto) {
    return this.documents.sign(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.documents.remove(id);
  }
}
