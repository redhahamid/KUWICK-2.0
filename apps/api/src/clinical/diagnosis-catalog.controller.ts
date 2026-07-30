import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DiagnosisCategory } from '@prisma/client';
import { DiagnosisService } from './diagnosis.service';
import { CreateCustomDiagnosisDto } from './dto/create-custom-diagnosis.dto';
import { BulkActivateCatalogDto } from './dto/bulk-activate-catalog.dto';

// The Diagnoses Directory admin screen backs onto this catalog — bulk
// per-category activation plus individual entries, matching kuwick.com
// (D-027, docs/DECISIONS.md).
@Controller('diagnosis-catalog')
export class DiagnosisCatalogController {
  constructor(private readonly diagnoses: DiagnosisService) {}

  @Get()
  search(@Query('search') search?: string, @Query('category') category?: DiagnosisCategory) {
    return this.diagnoses.searchCatalog(search, category);
  }

  @Get('directory')
  directory(@Query('category') category?: DiagnosisCategory) {
    return this.diagnoses.listCatalog(category);
  }

  @Get('counts')
  counts() {
    return this.diagnoses.catalogCounts();
  }

  @Post('custom')
  createCustom(@Body() dto: CreateCustomDiagnosisDto) {
    return this.diagnoses.createCustom(dto);
  }

  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body() dto: BulkActivateCatalogDto) {
    return this.diagnoses.setCatalogActive(id, dto.active);
  }

  @Patch('category/:category/active')
  bulkActivate(@Param('category') category: DiagnosisCategory, @Body() dto: BulkActivateCatalogDto) {
    return this.diagnoses.bulkActivateCategory(category, dto);
  }
}
