import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ClaimWorkspaceService } from './claim-workspace.service';
import { PanelConfigService } from './panel-config.service';
import { AdjudicateClaimDto } from './dto/adjudicate-claim.dto';
import { SubmitBatchDto } from './dto/submit-batch.dto';
import { WriteOffClaimDto } from './dto/write-off-claim.dto';
import { ChargeToPatientDto } from './dto/charge-to-patient.dto';
import { ResubmitClaimDto } from './dto/resubmit-claim.dto';
import { RecordRemittanceDto } from './dto/record-remittance.dto';
import { UpsertPanelConfigDto } from './dto/upsert-panel-config.dto';
import { ImportClaimsDto } from './dto/import-claims.dto';
import { ClaimImportService } from './claim-import.service';
import { PanelSetupService } from './panel-setup.service';
import { SetupPanelsDto } from './dto/setup-panels.dto';
import { PanelEmployerService } from './panel-employer.service';
import { CreatePanelEmployerDto, UpdatePanelEmployerDto } from './dto/panel-employer.dto';
import { OptionalDateParam, RequiredDateParam } from '../core/date-param.pipe';
import { assertDateOrder } from '../core/query-dates';

@Controller('panel-workspace')
export class PanelWorkspaceController {
  constructor(
    private readonly claims: ClaimWorkspaceService,
    private readonly config: PanelConfigService,
    private readonly imports: ClaimImportService,
    private readonly setup: PanelSetupService,
    private readonly employers: PanelEmployerService,
  ) {}

  // --- The employers behind a panel (N-5; closes G-9) ----------------------
  //
  // Nested under the panel because an employer belongs to one: the same company
  // reached through two TPAs is two agreements with two terms.

  @Get('panels/:panelClinicId/employers')
  listEmployers(
    @Param('panelClinicId') panelClinicId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.employers.list(panelClinicId, includeInactive === 'true');
  }

  @Post('panels/:panelClinicId/employers')
  createEmployer(
    @Param('panelClinicId') panelClinicId: string,
    @Body() dto: CreatePanelEmployerDto,
  ) {
    return this.employers.create(panelClinicId, dto);
  }

  @Patch('employers/:id')
  updateEmployer(@Param('id') id: string, @Body() dto: UpdatePanelEmployerDto) {
    return this.employers.update(id, dto);
  }

  // --- Setting the module up when it is empty (N-2) ------------------------

  /** Whether this clinic has any panels, and what the platform can suggest. */
  @Get('setup')
  setupStatus() {
    return this.setup.status();
  }

  /** Create the chosen panels, all or nothing. */
  @Post('setup')
  createPanels(@Body() dto: SetupPanelsDto) {
    return this.setup.createMany(dto);
  }

  // --- What has not been submitted -----------------------------------------

  @Get('submission-queue')
  submissionQueue(@Query('panelClinicId') panelClinicId?: string) {
    return this.claims.submissionQueue(panelClinicId);
  }

  @Patch('batches/:id/submitted')
  markSubmitted(@Param('id') id: string, @Body() dto: SubmitBatchDto) {
    return this.claims.markBatchSubmitted(id, dto);
  }

  // --- What the panel said --------------------------------------------------

  @Patch('claims/:id/adjudicate')
  adjudicate(@Param('id') id: string, @Body() dto: AdjudicateClaimDto) {
    return this.claims.adjudicate(id, dto);
  }

  @Post('claims/:id/resubmit')
  resubmit(@Param('id') id: string, @Body() dto: ResubmitClaimDto) {
    return this.claims.resubmit(id, dto);
  }

  /**
   * G-5 — the panel refused, so the patient pays. Permission-gated as a
   * write-off, because both decisions end a panel receivable and both need the
   * same seniority; what differs is where the money goes next.
   */
  @Patch('claims/:id/charge-to-patient')
  chargeToPatient(@Param('id') id: string, @Body() dto: ChargeToPatientDto) {
    return this.claims.chargeToPatient(id, dto);
  }

  @Patch('claims/:id/write-off')
  writeOff(@Param('id') id: string, @Body() dto: WriteOffClaimDto) {
    return this.claims.writeOff(id, dto);
  }

  @Get('claims/:id/timeline')
  timeline(@Param('id') id: string) {
    return this.claims.timeline(id);
  }

  // --- Where the money is ---------------------------------------------------

  @Post('remittances')
  recordRemittance(@Body() dto: RecordRemittanceDto) {
    return this.claims.recordRemittance(dto);
  }

  // --- Does it reconcile ----------------------------------------------------

  @Get('reconciliation')
  reconciliation(
    @Query('panelClinicId') panelClinicId?: string,
    @Query('from', OptionalDateParam) from?: string,
    @Query('to', OptionalDateParam) to?: string,
    @Query('asOf', OptionalDateParam) asOf?: string,
  ) {
    assertDateOrder(from, to);
    return this.claims.reconciliation({ panelClinicId, from, to, asOf });
  }

  @Get('awaiting-payment')
  awaitingPayment(@Query('panelClinicId') panelClinicId?: string) {
    return this.claims.awaitingPayment({ panelClinicId });
  }

  @Get('work-queue')
  workQueue(@Query('panelClinicId') panelClinicId?: string, @Query('includeResolved') includeResolved?: string) {
    return this.claims.workQueue({ panelClinicId, includeResolved: includeResolved === 'true' });
  }

  // --- Configuration --------------------------------------------------------

  @Get('panels')
  panels() {
    return this.config.list();
  }

  @Patch('panels/:id')
  updatePanel(@Param('id') id: string, @Body() dto: UpsertPanelConfigDto) {
    return this.config.update(id, dto);
  }

  // --- Historical claim import (G-12) ---------------------------------------
  //
  // Kuwick cannot start empty on cutover day. Every route here is a dry run
  // unless `commit` is true; see panel/claim-import.service.ts for the six
  // safety rules and why each one exists.

  @Get('import/template')
  importTemplate() {
    return this.imports.template();
  }

  @Get('import/batches')
  importBatches(@Query('panelClinicId') panelClinicId?: string) {
    return this.imports.list(panelClinicId);
  }

  @Post('import/claims')
  importClaims(@Body() dto: ImportClaimsDto) {
    return this.imports.import(dto);
  }
}
