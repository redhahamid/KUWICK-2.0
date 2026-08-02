import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { DiagnosisService } from './diagnosis.service';
import { AddDiagnosisDto } from './dto/add-diagnosis.dto';
import { SetDiagnosisPriorityDto } from './dto/set-diagnosis-priority.dto';
import { RemoveDiagnosisDto } from './dto/remove-diagnosis.dto';

// G2a (D-059) — scoped pipe, same reason as the clinical-note controller: a
// client that tries to post addedByStaffId must fail loudly with a 400 rather
// than have the field silently stripped and believe it set the author.
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('diagnoses')
export class DiagnosisController {
  constructor(private readonly diagnoses: DiagnosisService) {}

  // Active diagnoses only. A removed one must never reach the clinical view.
  @Get()
  findByVisit(@Query('visitId') visitId: string) {
    return this.diagnoses.findByVisitId(visitId);
  }

  // G2 closure (D-061) — the audit/history view: every diagnosis ever recorded
  // for the visit, including the ones removed in error, with their removal
  // actor, time and reason. Read-only by design; there is no route that
  // updates or deletes a removal event.
  @Get('history')
  history(@Query('visitId') visitId: string) {
    return this.diagnoses.findByVisitId(visitId, true);
  }

  @Post()
  add(@Body() dto: AddDiagnosisDto) {
    return this.diagnoses.addToVisit(dto);
  }

  @Patch(':id/priority')
  setPriority(@Param('id') id: string, @Body() dto: SetDiagnosisPriorityDto) {
    return this.diagnoses.setPriority(id, dto);
  }

  // G2 closure (D-061) — replaces DELETE /diagnoses/:id entirely.
  //
  // There is deliberately NO hard-delete route left for a saved diagnosis. A
  // removal is a clinical correction with a mandatory reason; the row, its
  // content and its original attribution survive it.
  @Patch(':id/removal')
  remove(@Param('id') id: string, @Body() dto: RemoveDiagnosisDto) {
    return this.diagnoses.removeFromVisit(id, dto);
  }
}
