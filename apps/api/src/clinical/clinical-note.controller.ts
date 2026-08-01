import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ClinicalNoteService } from './clinical-note.service';
import { UpsertClinicalNoteDto } from './dto/upsert-clinical-note.dto';

@Controller('visits/:visitId/clinical-notes')
export class ClinicalNoteController {
  constructor(private readonly clinicalNotes: ClinicalNoteService) {}

  @Get()
  list(@Param('visitId') visitId: string) {
    return this.clinicalNotes.listByVisitId(visitId);
  }

  @Post()
  create(@Param('visitId') visitId: string, @Body() dto: UpsertClinicalNoteDto) {
    return this.clinicalNotes.create(visitId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpsertClinicalNoteDto) {
    return this.clinicalNotes.update(id, dto);
  }
}
