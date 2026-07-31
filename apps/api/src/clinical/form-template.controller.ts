import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { FormTemplateService } from './form-template.service';
import { CreateFormTemplateDto } from './dto/create-form-template.dto';
import { UpdateFormTemplateDto } from './dto/update-form-template.dto';

@Controller('form-templates')
export class FormTemplateController {
  constructor(private readonly formTemplates: FormTemplateService) {}

  // Returns null (not 404) when the service has no form — most services
  // won't, and that's an expected, not an error, state (same convention
  // as GET /visits/:id/clinical-note).
  @Get()
  findByService(@Query('serviceCatalogId') serviceCatalogId: string) {
    return this.formTemplates.findByServiceCatalogId(serviceCatalogId);
  }

  @Post()
  create(@Body() dto: CreateFormTemplateDto) {
    return this.formTemplates.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFormTemplateDto) {
    return this.formTemplates.update(id, dto);
  }
}
