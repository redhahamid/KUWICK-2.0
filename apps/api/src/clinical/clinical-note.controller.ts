import { Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ClinicalNoteService } from './clinical-note.service';
import { AmendClinicalNoteDto } from './dto/amend-clinical-note.dto';
import { SignClinicalNoteDto } from './dto/sign-clinical-note.dto';
import { UpsertClinicalNoteDto } from './dto/upsert-clinical-note.dto';

// C0 (D-051). Note the routes that DON'T exist: there is no update or delete
// path for clinical_note_revisions anywhere in the API — the audit trail is
// append-only by construction, not by convention.
//
// forbidNonWhitelisted is applied HERE rather than globally: an attempt to
// post authorStaffId/signedByStaffId must fail loudly with a 400, not be
// silently stripped, so a client that thinks it is setting authorship finds
// out immediately. Scoping it to the clinical controllers avoids turning
// every other endpoint's harmless extra field into a breaking 400.
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
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

  @Post(':id/sign')
  sign(@Param('id') id: string, @Body() dto: SignClinicalNoteDto) {
    return this.clinicalNotes.sign(id, dto);
  }

  @Post(':id/amend')
  amend(@Param('id') id: string, @Body() dto: AmendClinicalNoteDto) {
    return this.clinicalNotes.amend(id, dto);
  }

  @Get(':id/revisions')
  revisions(@Param('id') id: string) {
    return this.clinicalNotes.listRevisions(id);
  }
}
