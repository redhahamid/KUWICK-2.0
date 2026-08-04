import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { VisitService } from './visit.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { DoctorCompletionService } from './doctor-completion.service';
import { CompleteDoctorPhaseDto } from './dto/complete-doctor-phase.dto';
import { VisitCompletionService } from './visit-completion.service';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { PanelBenefitService } from './panel-benefit.service';
import { BillingWorklistService } from './billing-worklist.service';
import { RecordPanelVerificationDto } from './dto/record-panel-verification.dto';
import { OverridePanelBenefitDto } from './dto/override-panel-benefit.dto';
import { SetVisitClassificationDto } from './dto/set-visit-classification.dto';

@Controller('visits')
export class VisitController {
  constructor(
    private readonly visits: VisitService,
    private readonly doctorCompletion: DoctorCompletionService,
    private readonly visitCompletion: VisitCompletionService,
    private readonly panelBenefit: PanelBenefitService,
    private readonly billingWorklist: BillingWorklistService,
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

  // G4.5d3c-3b1a (D-092) - what the panel's portal said about THIS visit.
  // Verification is counter work; override is a financial correction with a
  // mandatory reason. Neither computes money - the 3b1b engine reads these.
  @Patch(':id/panel-verification')
  recordPanelVerification(@Param('id') id: string, @Body() dto: RecordPanelVerificationDto) {
    return this.panelBenefit.recordVerification(id, dto);
  }

  @Patch(':id/panel-benefit-override')
  overridePanelBenefit(@Param('id') id: string, @Body() dto: OverridePanelBenefitDto) {
    return this.panelBenefit.overrideBenefit(id, dto);
  }

  // G4.5d3c-3b1 (D-093) - the itemised billing worklist: every chargeable
  // source with its billed state, for the 3b2 Billing Review surface. Read
  // only, database-enforced (D-088's read-only transaction).
  @Get(':id/billing-worklist')
  getBillingWorklist(@Param('id') id: string) {
    return this.billingWorklist.forVisit(id);
  }

  // G4.5d3c-3b2 (D-094) - the operational kind of visit for consultation
  // billing (OTC-only, dressing-only, ...). Counter work, refused for
  // doctors; locked once the visit completes.
  @Patch(':id/classification')
  setClassification(@Param('id') id: string, @Body() dto: SetVisitClassificationDto) {
    return this.visits.setClassification(id, dto.classification);
  }

  // What is still outstanding, so a screen can say so before offering the button.
  @Get(':id/completion-blockers')
  completionBlockers(@Param('id') id: string) {
    return this.visitCompletion.blockers(id);
  }
}
