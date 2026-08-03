import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { VisitService } from './visit.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { DoctorCompletionService } from './doctor-completion.service';
import { CompleteDoctorPhaseDto } from './dto/complete-doctor-phase.dto';
import { VisitCompletionService } from './visit-completion.service';
import { CompleteVisitDto } from './dto/complete-visit.dto';

@Controller('visits')
export class VisitController {
  constructor(
    private readonly visits: VisitService,
    private readonly doctorCompletion: DoctorCompletionService,
    private readonly visitCompletion: VisitCompletionService,
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
  // G4.5d3c-2c (D-088) - what is outstanding and where the patient would go,
  // without changing anything. Same evaluator the write uses, in a
  // database-enforced read-only transaction.
  @Get(':id/doctor-phase-status')
  doctorPhaseStatus(@Param('id') id: string) {
    return this.doctorCompletion.doctorPhaseStatus(id);
  }

  // G4.5d3c-2 (D-086) - the doctor finishes their part. The destination is
  // DERIVED, never accepted: there is no destination field on the DTO.
  @Patch(':id/complete-doctor-phase')
  completeDoctorPhase(@Param('id') id: string, @Body() dto: CompleteDoctorPhaseDto) {
    return this.doctorCompletion.completeDoctorPhase(id, dto);
  }
  // G4.5d3c-2b (D-087) - the ONLY operation that sets Visit.checkOutAt.
  @Patch(':id/complete')
  completeVisit(@Param('id') id: string, @Body() dto: CompleteVisitDto) {
    return this.visitCompletion.completeVisit(id, dto);
  }

  // What is still outstanding, so a screen can say so before offering the button.
  @Get(':id/completion-blockers')
  completionBlockers(@Param('id') id: string) {
    return this.visitCompletion.blockers(id);
  }
}
