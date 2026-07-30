import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { DiagnosisService } from './diagnosis.service';
import { AddDiagnosisDto } from './dto/add-diagnosis.dto';

@Controller('diagnoses')
export class DiagnosisController {
  constructor(private readonly diagnoses: DiagnosisService) {}

  @Get()
  findByVisit(@Query('visitId') visitId: string) {
    return this.diagnoses.findByVisitId(visitId);
  }

  @Post()
  add(@Body() dto: AddDiagnosisDto) {
    return this.diagnoses.addToVisit(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.diagnoses.remove(id);
  }
}
