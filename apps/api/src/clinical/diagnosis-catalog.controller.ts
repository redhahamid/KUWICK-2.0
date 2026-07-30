import { Controller, Get, Query } from '@nestjs/common';
import { DiagnosisService } from './diagnosis.service';

@Controller('diagnosis-catalog')
export class DiagnosisCatalogController {
  constructor(private readonly diagnoses: DiagnosisService) {}

  @Get()
  search(@Query('search') search?: string) {
    return this.diagnoses.searchCatalog(search);
  }
}
