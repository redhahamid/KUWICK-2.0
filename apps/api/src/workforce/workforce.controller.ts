import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
import { UpsertStatutoryRulesDto } from './dto/upsert-statutory-rules.dto';

@Controller('workforce')
export class WorkforceController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly attendance: AttendanceRecordService,
    private readonly leave: LeaveService,
    private readonly incentives: IncentiveService,
    private readonly payroll: PayrollService,
  ) {}

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
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('clinicId') clinicId?: string,
    @Query('staffId') staffId?: string,
  ) {
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

  @Get('payroll/statutory-rules')
  statutoryRules() {
    return this.payroll.listStatutoryRuleSets();
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

  @Patch('payroll/runs/:id/paid')
  markPayrollPaid(@Param('id') id: string) {
    return this.payroll.markPaid(id);
  }

  @Post('payroll/runs/:id/adjustments')
  adjustPayroll(@Param('id') id: string, @Body() dto: PayrollAdjustmentDto) {
    return this.payroll.adjust(id, dto);
  }
}
