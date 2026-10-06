import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { AcknowledgeExceptionsDto } from './dto/acknowledge-exceptions.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { EmploymentStatus, LeaveType, AttendanceCorrectionStatus } from '@prisma/client';
import { EmployeeService } from './employee.service';
import { JobTitleService } from './job-title.service';
import { CreateJobTitleDto, UpdateJobTitleDto } from './dto/job-title.dto';
import { AttendanceRecordService } from './attendance-record.service';
import { AttendancePolicyService } from './attendance-policy.service';
import { LeaveService } from './leave.service';
import { IncentiveService } from './incentive.service';
import { PayrollService } from './payroll.service';
import { UpsertEmployeeDto } from './dto/upsert-employee.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { EmployeeIntakeDto } from './dto/employee-intake.dto';
import { EmployeeIntakeService } from './employee-intake.service';
import { ClockDto } from './dto/clock.dto';
import { SaveAttendancePolicyDto } from './dto/save-attendance-policy.dto';
import { DecideCorrectionDto } from './dto/decide-correction.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { UpsertLeavePolicyDto } from './dto/upsert-leave-policy.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-leave-balance.dto';
import { UpsertIncentiveRuleDto } from './dto/upsert-incentive-rule.dto';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { PayrollAdjustmentDto } from './dto/payroll-adjustment.dto';
import { ImportYtdOpeningDto } from './dto/import-ytd-opening.dto';
import { UpsertStatutoryRulesDto } from './dto/upsert-statutory-rules.dto';
import { OptionalDateParam, RequiredDateParam } from '../core/date-param.pipe';
import { assertDateOrder } from '../core/query-dates';
import { BenefitService } from './benefit.service';
import { LegalEmployerService } from './legal-employer.service';
import { EmployeeSalaryService } from './employee-salary.service';
import { ContributionBasisService } from './contribution-basis.service';
import { StatutoryClassificationService } from './statutory-classification.service';
import { PayComponentService } from './pay-component.service';
import { StatutorySettingsService } from './statutory-settings.service';
import { PayrollPolicyService } from './payroll-policy.service';
import { PayrollInputService } from './payroll-input.service';
import { UpsertLegalEmployerDto } from './dto/upsert-legal-employer.dto';
import { RecordSalaryDto } from './dto/record-salary.dto';
import { CreateRecurringItemDto, UpdateRecurringItemDto } from './dto/recurring-item.dto';
import { EmployeeRecurringItemService } from './employee-recurring-item.service';
import { RecordContributionBasisDto } from './dto/record-contribution-basis.dto';
import {
  RecordEmployerStatutoryDto,
  RecordStatutoryClassificationDto,
} from './dto/record-statutory-classification.dto';
import { StaffClaimService } from './staff-claim.service';
import { LocumService } from './locum.service';
import { PayrollJourneyService } from './payroll-journey.service';
import { PayrollReadinessService } from './payroll-readiness.service';
import { PayrollPayslipService } from './payroll-payslip.service';
import { PayrollPaymentService } from './payroll-payment.service';
import { PayrollStatutoryOutputService } from './payroll-statutory-output.service';
import { PayrollFilingService } from './payroll-filing.service';
import { PayrollTaxService } from './payroll-tax.service';
import { renderPayslipPdf } from './payroll-payslip-pdf';
import { PayrollReportService } from './payroll-report.service';
import { PayrollFinanceService } from './payroll-finance.service';
import { CreateStaffClaimDto, DecideStaffClaimDto, SettleStaffClaimDto } from './dto/staff-claim.dto';
import {
  ApproveLocumSessionDto,
  RecordLocumSessionDto,
  SettleLocumSessionDto,
  UpdateLocumSessionDto,
} from './dto/locum-session.dto';
import { UpsertPayComponentDto } from './dto/upsert-pay-component.dto';
import { UpsertPayrollPolicyDto } from './dto/upsert-payroll-policy.dto';
import { UpsertPayrollInputDto } from './dto/upsert-payroll-input.dto';
import { SetApprovalPolicyDto } from './dto/set-approval-policy.dto';
import { SaveClaimPolicyDto } from './dto/save-claim-policy.dto';
import { StaffFileService, MAX_STAFF_FILE_BYTES } from './staff-file.service';
import { ClaimPolicyService } from './claim-policy.service';

@Controller('workforce')
export class WorkforceController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly intake: EmployeeIntakeService,
    private readonly jobTitles: JobTitleService,
    private readonly attendance: AttendanceRecordService,
    private readonly attendancePolicies: AttendancePolicyService,
    private readonly leave: LeaveService,
    private readonly incentives: IncentiveService,
    private readonly payroll: PayrollService,
    private readonly benefits_: BenefitService,
    private readonly legalEmployers: LegalEmployerService,
    private readonly salaries: EmployeeSalaryService,
    private readonly recurringItems: EmployeeRecurringItemService,
    private readonly contributionBases: ContributionBasisService,
    private readonly classifications: StatutoryClassificationService,
    private readonly payComponents: PayComponentService,
    private readonly statutorySettings: StatutorySettingsService,
    private readonly payrollPolicies: PayrollPolicyService,
    private readonly payrollInputs: PayrollInputService,
    private readonly claims: StaffClaimService,
    private readonly locum: LocumService,
    private readonly journey: PayrollJourneyService,
    private readonly readiness: PayrollReadinessService,
    private readonly payslipService: PayrollPayslipService,
    private readonly payments: PayrollPaymentService,
    private readonly statutoryOutputs_: PayrollStatutoryOutputService,
    private readonly filing: PayrollFilingService,
    private readonly tax: PayrollTaxService,
    private readonly reports: PayrollReportService,
    private readonly financeContract: PayrollFinanceService,
    private readonly staffFiles: StaffFileService,
    private readonly claimPolicies: ClaimPolicyService,
  ) {}

  // =========================================================================
  // MALAYSIA PAYROLL — STAGE 1 + STAGE 2
  // =========================================================================

  // --- Legal employer -------------------------------------------------------

  @Get('legal-employers')
  listLegalEmployers(@Query('clinicId') clinicId?: string) {
    return this.legalEmployers.list(clinicId || undefined);
  }

  @Get('legal-employers/:id')
  getLegalEmployer(@Param('id') id: string) {
    return this.legalEmployers.get(id);
  }

  @Post('legal-employers')
  upsertLegalEmployer(@Body() dto: UpsertLegalEmployerDto) {
    return this.legalEmployers.upsert(dto);
  }

  // The clinic's own job titles, picked from and added to on the employee form.
  @Get('job-titles')
  listJobTitles() {
    return this.jobTitles.list();
  }

  @Post('job-titles')
  createJobTitle(@Body() dto: CreateJobTitleDto) {
    return this.jobTitles.create(dto);
  }

  @Patch('job-titles/:id')
  updateJobTitle(@Param('id') id: string, @Body() dto: UpdateJobTitleDto) {
    return this.jobTitles.update(id, dto);
  }

  /**
   * ONE OR MANY PEOPLE, CHECKED TOGETHER AND WRITTEN TOGETHER. The single
   * form posts one row; the grid posts up to two hundred. `commit: false`
   * checks and writes nothing; `commit: true` writes only a clean batch.
   * Declared before the `employees/:staffId` routes so "intake" is never
   * read as somebody's id.
   */
  @Post('employees/intake')
  intakeEmployees(@Body() dto: EmployeeIntakeDto) {
    return this.intake.intake(dto);
  }

  @Patch('employees/:staffId/legal-employer')
  assignEmployer(@Param('staffId') staffId: string, @Body() body: { legalEmployerId: string | null; reason?: string | null }) {
    return this.legalEmployers.assignEmployee(staffId, body.legalEmployerId ?? null, body.reason ?? null);
  }

  // =========================================================================
  // STAGE 2.5 — THE MONTHLY PAYROLL JOURNEY
  //
  // Payroll Home answers "is this month done"; the journey serves the six
  // steps together, because they are six views of ONE run and serving them
  // separately is how step 1 and step 5 end up disagreeing about who is in the
  // month.
  // =========================================================================

  @Get('payroll/home')
  payrollHome(@Query('period') period?: string, @Query('clinicId') clinicId?: string) {
    return this.journey.home({ period, clinicId });
  }

  /**
   * WHO CAN BE PAID, BEFORE A RUN EXISTS. Per-employee checklists built by the
   * same code the employee record uses, from the same facts the run blocks on
   * — plus the employing companies' own filing readiness.
   */
  @Get('payroll/readiness')
  payrollReadiness(@Query('period') period?: string, @Query('clinicId') clinicId?: string) {
    return this.readiness.list({ period, clinicId });
  }

  @Get('payroll/runs/:id/journey')
  payrollJourney(@Param('id') id: string) {
    return this.journey.journey(id);
  }

  // =========================================================================
  // STAGE 2.5 — STAFF CLAIMS
  //
  // A reimbursement is a workflow, not a number typed into a payroll run. Every
  // approved claim has exactly one payment route, chosen at approval.
  // =========================================================================

  @Get('claims')
  listClaims(
    @Query('staffId') staffId?: string,
    @Query('status') status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
    @Query('period') period?: string,
    @Query('clinicId') clinicId?: string,
  ) {
    return this.claims.list({ staffId, status, period, clinicId });
  }

  @Get('claims/:id/history')
  claimHistory(@Param('id') id: string) {
    return this.claims.history(id);
  }

  @Post('claims')
  createClaim(@Body() dto: CreateStaffClaimDto) {
    return this.claims.create(dto);
  }

  @Post('claims/:id/decide')
  decideClaim(@Param('id') id: string, @Body() dto: DecideStaffClaimDto) {
    return this.claims.decide(id, dto);
  }

  /** Finance settled it. Refused for a claim routed to payroll. */
  @Post('claims/:id/settle')
  settleClaim(@Param('id') id: string, @Body() dto: SettleStaffClaimDto) {
    return this.claims.settle(id, dto);
  }

  @Post('claims/:id/cancel')
  cancelClaim(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.claims.cancel(id, body.reason);
  }

  // =========================================================================
  // STAGE 2.5 — LOCUM SESSIONS
  //
  // Work done by somebody who is NOT an employee. A payable, never a payslip.
  // =========================================================================

  @Get('locum/sessions')
  listLocumSessions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('staffId') staffId?: string,
    @Query('status') status?: string,
    @Query('clinicId') clinicId?: string,
  ) {
    return this.locum.list({ from, to, staffId, status, clinicId });
  }

  @Get('locum/payable')
  locumPayable(
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
    @Query('clinicId') clinicId?: string,
  ) {
    return this.locum.payableSummary(from, to, clinicId || undefined);
  }

  @Post('locum/sessions')
  recordLocumSession(@Body() dto: RecordLocumSessionDto) {
    return this.locum.record(dto);
  }

  @Patch('locum/sessions/:id')
  updateLocumSession(@Param('id') id: string, @Body() dto: UpdateLocumSessionDto) {
    return this.locum.update(id, dto);
  }

  @Post('locum/sessions/:id/approve')
  approveLocumSession(@Param('id') id: string, @Body() dto: ApproveLocumSessionDto) {
    return this.locum.approve(id, dto);
  }

  @Post('locum/sessions/:id/settle')
  settleLocumSession(@Param('id') id: string, @Body() dto: SettleLocumSessionDto) {
    return this.locum.settle(id, dto);
  }

  // =========================================================================
  // STAGE 2.5 — PAYROLL REPORTS
  //
  // Five reports over the SAME rows the run wrote. Nothing here recomputes a
  // figure — a report that adds up salaries its own way is a second engine,
  // and the two disagree in the month somebody finally checks. Every row
  // carries a link to the canonical record behind it.
  // =========================================================================

  @Get('payroll/reports')
  reportCatalogue() {
    return this.reports.catalogue();
  }

  @Get('payroll/runs/:id/reports/register')
  reportRegister(@Param('id') id: string) {
    return this.reports.register(id);
  }

  @Get('payroll/runs/:id/reports/employer-cost')
  reportEmployerCost(@Param('id') id: string) {
    return this.reports.employerCost(id);
  }

  @Get('payroll/runs/:id/reports/statutory')
  reportStatutory(@Param('id') id: string) {
    return this.reports.statutory(id);
  }

  @Get('payroll/runs/:id/reports/variance')
  reportVariance(@Param('id') id: string) {
    return this.reports.variance(id);
  }

  @Get('payroll/reports/history')
  reportHistory(@Query('staffId') staffId?: string, @Query('year') year?: string) {
    if (!staffId) throw new BadRequestException('staffId is required — this report is one employee’s history.');
    const parsedYear = year ? Number(year) : undefined;
    if (year && !Number.isInteger(parsedYear)) throw new BadRequestException('year must be a whole year, e.g. 2026.');
    return this.reports.history(staffId, parsedYear);
  }

  @Get('payroll/reports/ytd')
  reportYtd(
    @Query('year') year?: string,
    @Query('legalEmployerId') legalEmployerId?: string,
    @Query('clinicId') clinicId?: string,
  ) {
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear)) throw new BadRequestException('year must be a whole year, e.g. 2026.');
    return this.reports.ytd(parsedYear, legalEmployerId || undefined, clinicId || undefined);
  }

  @Get('payroll/runs/:id/reports/pcb')
  reportPcbSummary(@Param('id') id: string) {
    return this.reports.pcbSummary(id);
  }

  @Get('payroll/runs/:id/reports/overtime')
  reportOvertime(@Param('id') id: string) {
    return this.reports.overtime(id);
  }

  @Get('payroll/runs/:id/reports/unpaid-leave')
  reportUnpaidLeave(@Param('id') id: string) {
    return this.reports.unpaidLeave(id);
  }

  @Get('payroll/runs/:id/reports/incentives')
  reportIncentives(@Param('id') id: string) {
    return this.reports.incentives(id);
  }

  @Get('payroll/runs/:id/reports/exceptions')
  reportExceptions(@Param('id') id: string) {
    return this.reports.exceptions(id);
  }

  @Get('payroll/runs/:id/reports/payment-status')
  reportPaymentStatus(@Param('id') id: string) {
    return this.reports.paymentStatus(id);
  }

  /**
   * THE FINANCE CONTRACT. Gated by `finance.view`, NOT `hr.*` — the accounts
   * side reads canonical approved liabilities and payment state without ever
   * holding an HR permission or seeing a person's pay. Aggregates only.
   */
  @Get('payroll/finance/liabilities')
  financeLiabilities(@Query('year') year?: string) {
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear)) throw new BadRequestException('year must be a whole year, e.g. 2026.');
    return this.financeContract.liabilities(parsedYear);
  }

  @Get('payroll/reports/claims')
  reportClaims(
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
    @Query('clinicId') clinicId?: string,
  ) {
    assertDateOrder(from, to);
    return this.reports.claims({ from, to, clinicId: clinicId || undefined });
  }

  // --- Effective-dated salary ----------------------------------------------

  /**
   * Cutover parity for a period. Deliberately NOT under `employees/:staffId`:
   * the question is about the whole workforce, and asking it per employee is
   * how a cutover gets signed off on a sample.
   */
  @Get('salary/parity')
  salaryParity(@Query('period', RequiredDateParam) period: string) {
    return this.salaries.parity(period);
  }

  @Get('employees/:staffId/salary')
  salaryHistory(@Param('staffId') staffId: string) {
    return this.salaries.history(staffId);
  }

  @Get('employees/:staffId/salary/resolve')
  resolveSalary(@Param('staffId') staffId: string, @Query('period', RequiredDateParam) period: string) {
    // RequiredDateParam normalises to a YYYY-MM-DD STRING, not a Date.
    return this.salaries.resolveForPeriod(staffId, period);
  }

  @Post('employees/:staffId/salary')
  recordSalary(@Param('staffId') staffId: string, @Body() dto: RecordSalaryDto) {
    return this.salaries.record(staffId, dto);
  }

  // --- Recurring items: what a component carries for one employee monthly ----
  @Get('employees/:staffId/recurring-items')
  listRecurringItems(@Param('staffId') staffId: string) {
    return this.recurringItems.list(staffId);
  }

  @Get('recurring-item-choices')
  recurringItemChoices() {
    return this.recurringItems.choices();
  }

  @Post('employees/:staffId/recurring-items')
  createRecurringItem(@Param('staffId') staffId: string, @Body() dto: CreateRecurringItemDto) {
    return this.recurringItems.create(staffId, dto);
  }

  @Patch('employees/:staffId/recurring-items/:id')
  updateRecurringItem(@Param('staffId') staffId: string, @Param('id') id: string, @Body() dto: UpdateRecurringItemDto) {
    return this.recurringItems.update(staffId, id, dto);
  }

  // --- Employer-selected contribution basis ---------------------------------
  //
  // Which of the assessed wages the employer has CHOSEN to contribute EPF on.
  // A preference with a date, a reason and a name — never an assessment: the
  // catalogue keeps deciding what EPF wages ARE, and a month whose selection
  // leaves assessed wages out blocks at the run.

  @Get('employees/:staffId/contribution-basis')
  contributionBasisHistory(@Param('staffId') staffId: string) {
    return this.contributionBases.history(staffId);
  }

  @Post('employees/:staffId/contribution-basis')
  recordContributionBasis(@Param('staffId') staffId: string, @Body() dto: RecordContributionBasisDto) {
    return this.contributionBases.record(staffId, dto);
  }

  // --- Effective-dated statutory classification -----------------------------
  //
  // Which EPF Third Schedule Part somebody falls under, whether they joined
  // LINDUNG, their MTD category and their designated rest day are FACTS WITH
  // DATES, not form fields: recording a permanent residence in September used
  // to reprice March. These endpoints are the only way to change them.

  @Get('employees/:staffId/statutory-classification')
  classificationHistory(@Param('staffId') staffId: string) {
    return this.classifications.history(staffId);
  }

  @Get('employees/:staffId/statutory-classification/resolve')
  resolveClassification(@Param('staffId') staffId: string, @Query('period', RequiredDateParam) period: string) {
    return this.classifications.resolveForPeriod(staffId, period);
  }

  /** Remove a version recorded in error. Refused where an approved month reads it. */
  @Delete('employees/:staffId/statutory-classification/:id')
  deleteClassification(@Param('staffId') staffId: string, @Param('id') id: string, @Body('reason') reason?: string) {
    return this.classifications.remove(staffId, id, reason);
  }

  @Post('employees/:staffId/statutory-classification')
  recordClassification(@Param('staffId') staffId: string, @Body() dto: RecordStatutoryClassificationDto) {
    return this.classifications.record(staffId, dto);
  }

  @Get('legal-employers/:id/statutory-profile')
  employerStatutoryHistory(@Param('id') id: string) {
    return this.classifications.employerHistory(id);
  }

  @Get('legal-employers/:id/statutory-profile/resolve')
  resolveEmployerStatutory(@Param('id') id: string, @Query('period', RequiredDateParam) period: string) {
    return this.classifications.resolveEmployerForPeriod(id, period);
  }

  @Post('legal-employers/:id/statutory-profile')
  recordEmployerStatutory(@Param('id') id: string, @Body() dto: RecordEmployerStatutoryDto) {
    return this.classifications.recordEmployer(id, dto);
  }

  // --- Pay components -------------------------------------------------------

  @Get('pay-components')
  listPayComponents() {
    return this.payComponents.list();
  }

  @Get('pay-components/:code/history')
  payComponentHistory(@Param('code') code: string) {
    return this.payComponents.history(code);
  }

  @Post('pay-components/seed')
  seedPayComponents() {
    return this.payComponents.seed();
  }

  @Post('pay-components')
  upsertPayComponent(@Body() dto: UpsertPayComponentDto) {
    return this.payComponents.upsert(dto);
  }

  // --- Payroll policy -------------------------------------------------------

  @Get('payroll-policies')
  listPayrollPolicies() {
    return this.payrollPolicies.list();
  }

  @Post('payroll-policies')
  upsertPayrollPolicy(@Body() dto: UpsertPayrollPolicyDto) {
    return this.payrollPolicies.upsert(dto);
  }

  /** A rule set nobody uses can go; one that prices somebody, or that a payslip names, is refused with the reason. */
  @Delete('payroll-policies/:id')
  removePayrollPolicy(@Param('id') id: string, @Body() body: { reason?: string } = {}) {
    return this.payrollPolicies.remove(id, body?.reason);
  }

  // --- Payroll inputs — the write path that did not exist -------------------

  @Get('payroll/inputs')
  listPayrollInputs(
    @Query('period') period: string,
    @Query('staffId') staffId?: string,
    @Query('clinicId') clinicId?: string,
  ) {
    return this.payrollInputs.list({ period, staffId, clinicId });
  }

  @Post('payroll/inputs')
  upsertPayrollInput(@Body() dto: UpsertPayrollInputDto) {
    return this.payrollInputs.upsert(dto);
  }

  @Delete('payroll/inputs/:id')
  removePayrollInput(@Param('id') id: string) {
    return this.payrollInputs.remove(id);
  }

  @Post('payroll/inputs/materialise')
  materialisePayrollInputs(@Body() body: { period: string; clinicId?: string }) {
    return this.payrollInputs.materialise(body);
  }

  // --- Who is working today -------------------------------------------------

  @Get('today')
  today(@Query('clinicId') clinicId?: string) {
    return this.attendance.today(clinicId);
  }

  // --- Employees ------------------------------------------------------------

  /**
   * Active staff with no employment profile — the queue nobody could see.
   *
   * ABOVE `employees/:staffId`, or Nest reads "incomplete" as a staff id and
   * this route never runs. The same trap `provider-shift.controller.ts`
   * records for `/month`.
   */
  @Get('employees/incomplete')
  incompleteProfiles() {
    return this.employees.incompleteProfiles();
  }

  @Get('employees')
  listEmployees(
    @Query('clinicId') clinicId?: string,
    @Query('status') status?: EmploymentStatus,
    @Query('search') search?: string,
  ) {
    return this.employees.list({ clinicId, status, search });
  }

  @Get('employees/:staffId')
  getEmployee(@Param('staffId') staffId: string) {
    return this.employees.get(staffId);
  }

  /**
   * The whole employment record for one person, composed from the tables that
   * own each part. See `EmployeeService.record` — nothing here is a second
   * copy of anything, and pay stays behind `hr.payroll.view`.
   */
  @Get('employees/:staffId/record')
  employeeRecord(@Param('staffId') staffId: string, @Query('year') year?: string) {
    return this.employees.record(staffId, { year: year ? Number(year) : undefined });
  }

  @Get('employees/:staffId/payroll-detail')
  payrollDetail(@Param('staffId') staffId: string) {
    return this.employees.payrollView(staffId);
  }

  @Post('employees/:staffId')
  upsertEmployee(@Param('staffId') staffId: string, @Body() dto: UpsertEmployeeDto) {
    return this.employees.upsert(staffId, dto);
  }

  /**
   * Remove a record that should never have existed. Refused for anybody an
   * approved run has paid, and for anybody who has worked here — see
   * `EmployeeService.remove`.
   */
  @Delete('employees/:staffId')
  deleteEmployee(@Param('staffId') staffId: string, @Body('reason') reason?: string) {
    return this.employees.remove(staffId, reason);
  }

  /** Add somebody: staff row, employment profile and optionally a login. */
  @Post('employees')
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  // --- Attendance -----------------------------------------------------------

  @Post('attendance/clock')
  clock(@Body() dto: ClockDto) {
    return this.attendance.clock(dto);
  }

  @Patch('attendance/:id/correct')
  correct(@Param('id') id: string, @Body() dto: CorrectAttendanceDto) {
    return this.attendance.correct(id, dto);
  }

  @Patch('attendance/:id/approve-overtime')
  approveOvertime(@Param('id') id: string, @Body('minutes') minutes?: number) {
    return this.attendance.approveOvertime(id, minutes);
  }

  /**
   * HOW THIS CLINIC MEASURES ATTENDANCE — and where each rule came from.
   *
   * Readable by anybody who may open HR, because every screen showing a late
   * arrival has to be able to say what late means here.
   */
  /** A file HR hands in for an employee — the paper receipt behind a claim entered on their behalf. `hr.employee.manage`. */
  @Post('staff-files')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_STAFF_FILE_BYTES } }))
  uploadStaffFile(@Query('staffId') staffId?: string, @Query('kind') kind?: string, @UploadedFile() file?: Express.Multer.File) {
    return this.staffFiles.uploadFor(staffId ?? '', kind ?? '', file);
  }

  /** A file an employee handed in — the timesheet's selfie, the claims drawer's receipt, the MC. `hr.view`. */
  @Get('staff-files/:id')
  async staffFile(@Param('id') id: string, @Res() res: Response) {
    const row = await this.staffFiles.readForHr(id);
    res.setHeader('Content-Type', row.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${row.fileName.replace(/["\\]/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(row.data));
  }

  /** How the clinic prices and polices claims: the mileage rate, whether a receipt is required. */
  @Get('claim-policy')
  claimPolicy() {
    return this.claimPolicies.read();
  }

  @Put('claim-policy')
  saveClaimPolicy(@Body() dto: SaveClaimPolicyDto) {
    return this.claimPolicies.save(dto);
  }

  @Get('attendance/policy')
  attendancePolicy(@Query('clinicId') clinicId?: string) {
    return this.attendancePolicies.effective(clinicId);
  }

  @Get('attendance/policies')
  attendancePolicies_(){
    return this.attendancePolicies.list();
  }

  /** Group default when `clinicId` is omitted; one clinic's override when it is not. */
  @Post('attendance/policy')
  saveAttendancePolicy(@Body() dto: SaveAttendancePolicyDto) {
    return this.attendancePolicies.save(dto);
  }

  /** What staff have asked to have put right, and the decision on each. */
  @Get('attendance/corrections')
  correctionRequests(
    @Query('clinicId') clinicId?: string,
    @Query('status') status?: AttendanceCorrectionStatus,
  ) {
    return this.attendance.correctionRequests({ clinicId, status });
  }

  @Post('attendance/corrections/:id/decide')
  decideCorrection(@Param('id') id: string, @Body() dto: DecideCorrectionDto) {
    return this.attendance.decideCorrection(id, dto);
  }

  @Get('attendance/timesheet')
  timesheet(
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
    @Query('clinicId') clinicId?: string,
    @Query('staffId') staffId?: string,
  ) {
    assertDateOrder(from, to);
    return this.attendance.timesheet({ from, to, clinicId, staffId });
  }

  // --- Leave ----------------------------------------------------------------

  @Get('leave/policies')
  leavePolicies() {
    return this.leave.listPolicies();
  }

  @Post('leave/policies')
  upsertLeavePolicy(@Body() dto: UpsertLeavePolicyDto) {
    return this.leave.upsertPolicy(dto);
  }

  /**
   * EVERYBODY'S BALANCES — the Leave screen's Balances view.
   *
   * Declared BEFORE `leave/balances/:staffId`, because Nest matches routes in
   * declaration order and `:staffId` would otherwise swallow this path.
   */
  @Get('leave/balances')
  leaveBalancesForEveryone(@Query('clinicId') clinicId?: string, @Query('year') year?: string) {
    return this.leave.balancesForEveryone({ clinicId, year: year ? Number(year) : undefined });
  }

  @Get('leave/balances/:staffId')
  leaveBalances(@Param('staffId') staffId: string, @Query('year') year?: string) {
    return this.leave.balancesFor(staffId, year ? Number(year) : undefined);
  }

  @Post('leave/balances/adjust')
  adjustLeaveBalance(@Body() dto: AdjustLeaveBalanceDto) {
    return this.leave.adjustBalance(dto);
  }

  @Get('leave/availability')
  leaveAvailability(
    @Query('staffId') staffId: string,
    @Query('leaveType') leaveType: LeaveType,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.leave.checkAvailability(staffId, leaveType, startDate, endDate);
  }

  // --- Incentives -----------------------------------------------------------

  @Get('incentives/rules')
  incentiveRules() {
    return this.incentives.listRules();
  }

  @Post('incentives/rules')
  upsertIncentiveRule(@Body() dto: UpsertIncentiveRuleDto) {
    return this.incentives.upsertRule(dto);
  }

  @Get('incentives/runs')
  incentiveRuns(@Query('clinicId') clinicId?: string, @Query('year') year?: string) {
    return this.incentives.list({ clinicId, year: year ? Number(year) : undefined });
  }

  @Get('incentives/runs/:id')
  incentiveRun(@Param('id') id: string) {
    return this.incentives.detail(id);
  }

  @Post('incentives/calculate')
  calculateIncentives(@Body('period') period: string, @Body('clinicId') clinicId?: string) {
    return this.incentives.calculate(period, clinicId);
  }

  @Patch('incentives/runs/:id/approve')
  approveIncentiveRun(@Param('id') id: string) {
    return this.incentives.approve(id);
  }

  // --- TP1 / TP3 — the forms that change a month's tax ----------------------

  @Get('employees/:staffId/tax-records')
  taxRecords(@Param('staffId') staffId: string, @Query('year') year?: string) {
    return this.tax.taxRecords(staffId, year ? Number(year) : undefined);
  }

  @Post('employees/:staffId/tp1')
  recordTp1(
    @Param('staffId') staffId: string,
    @Body()
    body: {
      period: string;
      deductionsCents: number;
      zakatSelfPaidCents?: number;
      items?: { label: string; amountCents: number }[];
      receivedDate?: string;
      note?: string;
    },
  ) {
    return this.tax.recordTp1(staffId, body);
  }

  @Delete('payroll/tp1/:id')
  deleteTp1(@Param('id') id: string) {
    return this.tax.deleteTp1(id);
  }

  @Post('employees/:staffId/tp3')
  recordTp3(
    @Param('staffId') staffId: string,
    @Body()
    body: {
      taxYear: number;
      previousEmployerName: string;
      employmentFrom?: string;
      employmentTo?: string;
      grossCents: number;
      epfCents: number;
      mtdPaidCents: number;
      zakatCents?: number;
      deductionsCents?: number;
      source: string;
      note?: string;
    },
  ) {
    return this.tax.recordTp3(staffId, body);
  }

  @Delete('payroll/tp3/:id')
  deleteTp3(@Param('id') id: string) {
    return this.tax.deleteTp3(id);
  }

  // --- Payroll --------------------------------------------------------------

  @Get('payroll/employees/:staffId/ytd')
  employeeYtd(@Param('staffId') staffId: string, @Query('year') year?: string, @Query('throughMonth') throughMonth?: string) {
    return this.payroll.yearToDate(
      staffId,
      year ? Number(year) : new Date().getUTCFullYear(),
      throughMonth ? Number(throughMonth) : undefined,
    );
  }

  @Post('payroll/ytd-opening')
  importYtdOpening(@Body() dto: ImportYtdOpeningDto) {
    return this.payroll.importYtdOpening(dto);
  }

  @Get('payroll/statutory-rules')
  statutoryRules() {
    return this.payroll.listStatutoryRuleSets();
  }

  /**
   * Schemes Kuwick KNOWS it cannot price — LINDUNG phases 2–3, the Employment
   * Act First Schedule special categories. The service has said this since the
   * registry was built; nothing ever mounted it, so the gap register was
   * unreachable from every screen.
   */
  @Get('payroll/statutory-gaps')
  statutoryGaps() {
    return this.payroll.listStatutoryGaps();
  }

  @Post('payroll/statutory-rules')
  upsertStatutoryRules(@Body() dto: UpsertStatutoryRulesDto) {
    return this.payroll.upsertStatutoryRules(dto);
  }

  /**
   * The tables the calculation reads, exposed for the Statutory rates screen.
   * Read-only by construction: there is nothing here a clinic can type into.
   */
  @Get('payroll/statutory-rates')
  // `?period=YYYY-MM` shows the edition that priced that month; blank is this month.
  statutoryRates(@Query('period') period?: string) {
    return this.statutorySettings.rates(period || undefined);
  }

  /** A named person here looked at the tables today. Kept apart from the
      registry's own verification, which this does not move. */
  @Post('payroll/statutory-check')
  markStatutoryChecked() {
    return this.statutorySettings.markChecked();
  }

  @Get('payroll/runs')
  payrollRuns(@Query('clinicId') clinicId?: string, @Query('year') year?: string) {
    return this.payroll.list({ clinicId, year: year ? Number(year) : undefined });
  }

  @Get('payroll/runs/:id')
  payrollRun(@Param('id') id: string) {
    return this.payroll.detail(id);
  }

  @Post('payroll/runs')
  createPayrollRun(@Body() dto: CreatePayrollRunDto) {
    return this.payroll.create(dto);
  }

  @Patch('payroll/runs/:id/calculate')
  calculatePayroll(@Param('id') id: string) {
    return this.payroll.calculate(id);
  }

  /** Throw an unapproved run away. Approved and paid months are refused. */
  @Delete('payroll/runs/:id')
  discardPayrollRun(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.payroll.discard(id, reason);
  }

  @Patch('payroll/runs/:id/approve')
  approvePayroll(@Param('id') id: string, @Body('acknowledgeStatutoryGap') acknowledge?: boolean) {
    return this.payroll.approve(id, acknowledge === true);
  }

  /**
   * WHO IS ALLOWED TO APPROVE PAYROLL, as a setting. Reading it needs only the
   * payroll permission — a screen has to be able to say what the rule is —
   * while changing it is owner-level, enforced in the service.
   */
  @Get('payroll/approval-policy')
  payrollApprovalPolicy() {
    return this.payroll.approvalPolicy();
  }

  @Put('payroll/approval-policy')
  setPayrollApprovalPolicy(@Body() dto: SetApprovalPolicyDto) {
    return this.payroll.setApprovalPolicy(dto);
  }

  // `PATCH payroll/runs/:id/paid` is GONE, deliberately. It set a run to PAID
  // with no payment batch, no date, no reference and no reconciliation
  // against the approved net — a second, unrecorded path to the one word the
  // payment ladder exists to protect. Recording a payment is
  // `POST payroll/runs/:id/payment/record-paid`, which demands all three.

  @Get('payroll/runs/:id/exceptions')
  payrollExceptions(@Param('id') id: string) {
    return this.payroll.exceptions(id);
  }

  @Patch('payroll/exceptions/:id/override')
  overridePayrollException(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.payroll.overrideException(id, body.reason);
  }

  /** One reason for every open warning of one kind on the run: a policy acknowledged for the year. */
  @Patch('payroll/runs/:id/exceptions/acknowledge')
  acknowledgePayrollExceptions(@Param('id') id: string, @Body() dto: AcknowledgeExceptionsDto) {
    return this.payroll.acknowledgeExceptions(id, dto.code, dto.reason);
  }

  @Get('payroll/runs/:id/variance')
  payrollVariance(@Param('id') id: string, @Query('threshold') threshold?: string) {
    return this.payroll.variance(id, threshold ? Number(threshold) : undefined);
  }

  @Get('payroll/runs/:id/snapshots')
  payrollSnapshots(@Param('id') id: string) {
    return this.payroll.snapshots(id);
  }

  /**
   * ONE FROZEN APPROVAL, with a FRESH verification of it.
   *
   * The record of what a clinic approved is only worth something if it can be
   * checked, so this re-hashes the stored payload and re-runs the run's own
   * invariants over the frozen figures on every read.
   */
  @Get('payroll/runs/:id/snapshots/:version')
  payrollSnapshot(@Param('id') id: string, @Param('version') version: string) {
    return this.payroll.snapshot(id, Number(version));
  }

  @Get('payroll/runs/:id/candidate-diff')
  payrollCandidateDiff(@Param('id') id: string) {
    return this.payroll.candidateDiff(id);
  }

  // --- Payment preparation — a document is not a transfer -------------------

  @Get('payroll/runs/:id/payment')
  paymentStatus(@Param('id') id: string) {
    return this.payments.status(id);
  }

  @Post('payroll/runs/:id/payment/prepare')
  preparePayment(@Param('id') id: string) {
    return this.payments.prepare(id);
  }

  /** A CSV instruction listing for keying into a bank portal. NOT a bank file. */
  @Get('payroll/runs/:id/payment/listing')
  async paymentListing(@Param('id') id: string, @Res() res: Response) {
    const file = await this.payments.download(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.content);
  }

  @Post('payroll/runs/:id/payment/record-paid')
  recordPaymentPaid(
    @Param('id') id: string,
    @Body() body: { paymentDate: string; reference: string; note?: string },
  ) {
    return this.payments.recordPaid(id, body);
  }

  // --- Statutory outputs — prepared and reconciled, never submitted ---------

  @Get('payroll/runs/:id/statutory-outputs')
  statutoryOutputs(@Param('id') id: string) {
    return this.statutoryOutputs_.outputs(id);
  }

  /** One scheme's rows as CSV — a listing, not any authority's file format. */
  @Get('payroll/runs/:id/statutory-outputs/:scheme/listing')
  async statutoryListing(@Param('id') id: string, @Param('scheme') scheme: string, @Res() res: Response) {
    const file = await this.statutoryOutputs_.listing(id, scheme);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.content);
  }

  @Post('payroll/runs/:id/statutory-outputs/:scheme/record-submission')
  recordStatutorySubmission(
    @Param('id') id: string,
    @Param('scheme') scheme: string,
    @Body() body: { submittedDate: string; reference: string; note?: string },
  ) {
    return this.statutoryOutputs_.recordSubmission(id, scheme, body);
  }

  // --- Statutory filing helper — the same month, per agency, for the portal --

  @Get('payroll/runs/:id/filing')
  statutoryFiling(@Param('id') id: string) {
    return this.filing.view(id);
  }

  /** "Submitted" for one agency: the same date and reference on every scheme it covers. */
  @Post('payroll/runs/:id/filing/:agency/record-submission')
  recordAgencyFiling(
    @Param('id') id: string,
    @Param('agency') agency: string,
    @Body() body: { submittedDate: string; reference: string; note?: string },
  ) {
    return this.filing.recordSubmission(id, agency, body);
  }

  // --- Payslips, from the approved snapshot and nowhere else ----------------

  @Get('payroll/runs/:id/payslips')
  payslips(@Param('id') id: string) {
    return this.payslipService.list(id);
  }

  @Get('payroll/runs/:id/payslips/:staffId')
  payslip(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Query('version') version?: string,
  ) {
    return this.payslipService.payslip(id, staffId, version ? Number(version) : undefined);
  }

  /** The PDF. Audited: a payslip leaving the system has a who and a when. */
  @Get('payroll/runs/:id/payslips/:staffId/pdf')
  async payslipPdf(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Res() res: Response,
    @Query('version') version?: string,
  ) {
    const slip = await this.payslipService.payslipForDownload(id, staffId, version ? Number(version) : undefined);
    const pdf = await renderPayslipPdf(slip);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payslip-${slip.period}-${(slip.employee.name || 'employee').replace(/[^A-Za-z0-9-]+/g, '-')}-r${slip.revision.version}.pdf"`,
    );
    res.send(pdf);
  }

  @Patch('payroll/runs/:id/reopen')
  reopenPayrollRun(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.payroll.reopen(id, body.reason);
  }

  @Post('payroll/runs/:id/adjustments')
  adjustPayroll(@Param('id') id: string, @Body() dto: PayrollAdjustmentDto) {
    return this.payroll.adjust(id, dto);
  }
  // --- Staff benefits ---------------------------------------------------------

  @Get('benefits')
  benefits(@Query('year') year?: string, @Query('clinicId') clinicId?: string) {
    return this.benefits_.list({ year: year ? Number(year) : undefined, clinicId });
  }
}
