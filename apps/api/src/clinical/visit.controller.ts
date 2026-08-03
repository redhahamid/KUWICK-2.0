import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { VisitService } from './visit.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { DoctorCompletionService } from './doctor-completion.service';
import { CompleteDoctorPhaseDto } from './dto/complete-doctor-phase.dto';

@Controller('visits')
export class VisitController {
  constructor(
    private readonly visits: VisitService,
    private readonly doctorCompletion: DoctorCompletionService,
  ) {}

  // Patient Dashboard's "New Visit" — creates a Visit with no queue ticket,
  // for a patient who needs a medical record entry outside the front-desk
  // queue flow (e.g. a doctor-initiated follow-up).
  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto);
  }

  @Get()
  findAll(@Query('clinicId') clinicId?: string, @Query('patientId') patientId?: string) {
    return this.visits.findAll({ clinicId, patientId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findById(id);
  }
  // G4.5d3c-2 (D-086) - the doctor finishes their part. The destination is
  // DERIVED, never accepted: there is no destination field on the DTO.
  @Patch(':id/complete-doctor-phase')
  completeDoctorPhase(@Param('id') id: string, @Body() dto: CompleteDoctorPhaseDto) {
    return this.doctorCompletion.completeDoctorPhase(id, dto);
  }
}
