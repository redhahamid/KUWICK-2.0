import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ClinicalNoteService } from './clinical-note.service';
import { UpsertClinicalNoteDto } from './dto/upsert-clinical-note.dto';

@Controller('visits/:visitId/clinical-note')
export class ClinicalNoteController {
  constructor(private readonly clinicalNotes: ClinicalNoteService) {}

  @Get()
  find(@Param('visitId') visitId: string) {
    return this.clinicalNotes.findByVisitId(visitId);
  }

  @Put()
  upsert(@Param('visitId') visitId: string, @Body() dto: UpsertClinicalNoteDto) {
    return this.clinicalNotes.upsert(visitId, dto);
  }
}
