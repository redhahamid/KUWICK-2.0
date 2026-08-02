import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { DiagnosisService } from './diagnosis.service';
import { AddDiagnosisDto } from './dto/add-diagnosis.dto';
import { SetDiagnosisPriorityDto } from './dto/set-diagnosis-priority.dto';

// G2a (D-059) — scoped pipe, same reason as the clinical-note controller: a
// client that tries to post addedByStaffId must fail loudly with a 400 rather
// than have the field silently stripped and believe it set the author.
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
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

  @Patch(':id/priority')
  setPriority(@Param('id') id: string, @Body() dto: SetDiagnosisPriorityDto) {
    return this.diagnoses.setPriority(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.diagnoses.remove(id);
  }
}
