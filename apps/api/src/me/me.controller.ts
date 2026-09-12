import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { renderPayslipPdf } from '../workforce/payroll-payslip-pdf';
import { MeService } from './me.service';
import {
  AttachReceiptDto,
  ClockSelfDto,
  RequestAttendanceCorrectionDto,
  RequestLeaveDto,
  SubmitClaimDto,
} from './dto/self-service.dto';

/**
 * MY KUWICK — the staff-facing half of the workforce product.
 *
 * Every route here acts on the person holding the token. NONE of them accepts
 * a staff id, which is the security model stated in the signatures rather than
 * enforced by a check somebody has to remember: there is nowhere to put
 * somebody else's id.
 *
 * Mounted at `/me` and NOT under `/workforce`, because `/workforce` is the
 * administrative module and everything in it is permission-gated. These are
 * gated by identity: an owner cannot withhold somebody's own attendance record
 * from them, and there is deliberately no permission that would let them.
 */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  profile() {
    return this.me.profile();
  }

  /** The phone's home screen: am I clocked in, what is today, what is waiting. */
  @Get('home')
  home() {
    return this.me.home();
  }

  @Get('schedule')
  schedule(@Query('from') from: string, @Query('to') to: string) {
    return this.me.schedule(from, to);
  }

  // --- Attendance -----------------------------------------------------------

  @Post('attendance/clock')
  clock(@Body() dto: ClockSelfDto) {
    return this.me.clock(dto);
  }

  @Get('attendance')
  attendance(@Query('from') from: string, @Query('to') to: string) {
    return this.me.attendanceHistory(from, to);
  }

  /** Ask for a punch to be put right. An employee never writes the history. */
  @Post('attendance/corrections')
  requestCorrection(@Body() dto: RequestAttendanceCorrectionDto) {
    return this.me.requestCorrection(dto);
  }

  @Post('attendance/corrections/:id/cancel')
  cancelCorrection(@Param('id') id: string) {
    return this.me.cancelCorrection(id);
  }

  // --- Leave ----------------------------------------------------------------

  @Get('leave')
  leave() {
    return this.me.leave();
  }

  @Post('leave')
  requestLeave(@Body() dto: RequestLeaveDto) {
    return this.me.requestLeave(dto);
  }

  // --- Claims ---------------------------------------------------------------

  @Get('claims')
  claims() {
    return this.me.claims();
  }

  @Post('claims')
  submitClaim(@Body() dto: SubmitClaimDto) {
    return this.me.submitClaim(dto);
  }

  @Post('claims/:id/receipts')
  attachReceipt(@Param('id') id: string, @Body() dto: AttachReceiptDto) {
    return this.me.attachReceipt(id, dto);
  }

  // --- Payslips -------------------------------------------------------------

  /** Balances by type for the year, and the unpaid days taken — the Leave tab's right-hand panel. */
  @Get('leave/balances')
  leaveBalances() {
    return this.me.leaveBalances();
  }

  /**
   * What a request would mean before it is sent: the days, the balance after,
   * who else is away, the public holidays inside it. Read-only; nothing saved.
   */
  @Get('leave/preview')
  leavePreview(
    @Query('leaveType') leaveType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('halfDay') halfDay?: string,
  ) {
    return this.me.leavePreview({ leaveType, startDate, endDate, halfDay });
  }

  /** The medical benefit: allowance, used, left — this year. */
  @Get('benefits')
  benefits() {
    return this.me.benefits();
  }

  @Get('payslips')
  payslips() {
    return this.me.payslips();
  }

  @Get('payslips/:runId')
  payslip(@Param('runId') runId: string) {
    return this.me.payslip(runId);
  }

  /** The PDF of a PAID month, for its own employee. */
  @Get('payslips/:runId/pdf')
  async payslipPdf(@Param('runId') runId: string, @Res() res: Response) {
    const slip = await this.me.payslipPdf(runId);
    const pdf = await renderPayslipPdf(slip);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${slip.period}.pdf"`);
    res.send(pdf);
  }
}
