import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DocumentTemplateService } from './document-template.service';
import { CreateDocumentTemplateDto, UpdateDocumentTemplateDto } from './dto/create-document-template.dto';

@Controller('document-templates')
export class DocumentTemplateController {
  constructor(private readonly templates: DocumentTemplateService) {}

  @Get()
  findAll(@Query('activeOnly') activeOnly?: string) {
    return this.templates.findAll(activeOnly === 'true');
  }

  @Post()
  create(@Body() dto: CreateDocumentTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDocumentTemplateDto) {
    return this.templates.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templates.remove(id);
  }
}
