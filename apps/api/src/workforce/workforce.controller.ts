import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { EmploymentStatus, LeaveType } from '@prisma/client';
import { EmployeeService } from './employee.service';
import { AttendanceRecordService } from './attendance-record.service';
import { LeaveService } from './leave.service';
import { IncentiveService } from './incentive.service';
import { PayrollService } from './payroll.service';
import { UpsertEmployeeDto } from './dto/upsert-employee.dto';
import { ClockDto } from './dto/clock.dto';
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
import { StatutoryClassificationService } from './statutory-classification.service';
import { PayComponentService } from './pay-component.service';
import { PayrollPolicyService } from './payroll-policy.service';
import { PayrollInputService } from './payroll-input.service';
import { UpsertLegalEmployerDto } from './dto/upsert-legal-employer.dto';
import { RecordSalaryDto } from './dto/record-salary.dto';
import {
  RecordEmployerStatutoryDto,
  RecordStatutoryClassificationDto,
} from './dto/record-statutory-classification.dto';
import { StaffClaimService } from './staff-claim.service';
import { LocumService } from './locum.service';
import { PayrollJourneyService } from './payroll-journey.service';
import { PayrollReadinessService } from './payroll-readiness.service';
import { PayrollReportService } from './payroll-report.service';
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

@Controller('workforce')
export class WorkforceController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly attendance: AttendanceRecordService,
    private readonly leave: LeaveService,
    private readonly incentives: IncentiveService,
    private readonly payroll: PayrollService,
    private readonly benefits_: BenefitService,
    private readonly legalEmployers: LegalEmployerService,
    private readonly salaries: EmployeeSalaryService,
    private readonly classifications: StatutoryClassificationService,
    private readonly payComponents: PayComponentService,
    private readonly payrollPolicies: PayrollPolicyService,
    private readonly payrollInputs: PayrollInputService,
    private readonly claims: StaffClaimService,
    private readonly locum: LocumService,
    private readonly journey: PayrollJourneyService,
    private readonly readiness: PayrollReadinessService,
    private readonly reports: PayrollReportService,
  ) {}

  // =========================================================================
  // MALAYSIA PAYROLL — STAGE 1 + STAGE 2
  // =========================================================================

  // --- Legal employer -------------------------------------------------------

  @Get('legal-employers')
  listLegalEmployers() {
    return this.legalEmployers.list();
  }

  @Get('legal-employers/:id')
  getLegalEmployer(@Param('id') id: string) {
    return this.legalEmployers.get(id);
  }

  @Post('legal-employers')
  upsertLegalEmployer(@Body() dto: UpsertLegalEmployerDto) {
    return this.legalEmployers.upsert(dto);
  }

  @Patch('employees/:staffId/legal-employer')
  assignEmployer(@Param('staffId') staffId: string, @Body() body: { legalEmployerId: string | null }) {
    return this.legalEmployers.assignEmployee(staffId, body.legalEmployerId ?? null);
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
  ) {
    return this.claims.list({ staffId, status, period });
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
  ) {
    return this.locum.list({ from, to, staffId, status });
  }

  @Get('locum/payable')
  locumPayable(
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
  ) {
    return this.locum.payableSummary(from, to);
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

  @Get('payroll/reports/claims')
  reportClaims(
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
  ) {
    assertDateOrder(from, to);
    return this.reports.claims({ from, to });
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

  // --- Payroll --------------------------------------------------------------

  @Get('payroll/employees/:staffId/ytd')
  employeeYtd(@Param('staffId') staffId: string, @Query('year') year?: string) {
    return this.payroll.yearToDate(staffId, year ? Number(year) : new Date().getUTCFullYear());
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

  @Patch('payroll/runs/:id/paid')
  markPayrollPaid(@Param('id') id: string) {
    return this.payroll.markPaid(id);
  }

  @Get('payroll/runs/:id/exceptions')
  payrollExceptions(@Param('id') id: string) {
    return this.payroll.exceptions(id);
  }

  @Patch('payroll/exceptions/:id/override')
  overridePayrollException(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.payroll.overrideException(id, body.reason);
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
