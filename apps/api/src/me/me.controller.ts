import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MAX_STAFF_FILE_BYTES, StaffFileService } from '../workforce/staff-file.service';
import type { Request, Response } from 'express';
import { renderPayslipPdf } from '../workforce/payroll-payslip-pdf';
import { MeService } from './me.service';
import { clientIp } from '../workforce/attendance-qr';
import { AttachReceiptDto, ClockSelfDto, SetAttendancePinDto, RequestAttendanceCorrectionDto, RequestLeaveDto, SubmitClaimDto, RequestBankChangeDto, UpdateMyContactDto } from './dto/self-service.dto';

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
  constructor(
    private readonly me: MeService,
    private readonly files: StaffFileService,
  ) {}

  @Get()
  profile() {
    return this.me.profile();
  }

  /** The signed-in person's own display name. */
  @Patch('name')
  rename(@Body() body: { fullName?: string }) {
    return this.me.rename(body?.fullName);
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

  // --- Files and consent --------------------------------------------------
  //
  // A receipt, an MC or a selfie is uploaded first, as the person's own
  // file, and then named on the thing it belongs to. Served back only to the
  // person (here) and to HR (workforce/staff-files).

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_STAFF_FILE_BYTES } }))
  uploadFile(@Query('kind') kind?: string, @UploadedFile() file?: Express.Multer.File) {
    return this.files.upload(kind ?? '', file);
  }

  @Get('files/:id')
  async readFile(@Param('id') id: string, @Res() res: Response) {
    const row = await this.files.readOwn(id);
    res.setHeader('Content-Type', row.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${row.fileName.replace(/["\\]/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(row.data));
  }

  /** Agree, once, to a clock-in selfie being kept as proof. */
  @Post('consent/selfie')
  selfieConsent() {
    return this.me.giveSelfieConsent();
  }

  /** The mileage rate and the receipt rule the portal prices and checks with. */
  @Get('claim-policy')
  claimPolicy() {
    return this.me.claimPolicyForPortal();
  }

  @Post('attendance/clock')
  clock(@Body() dto: ClockSelfDto, @Req() req: Request) {
    return this.me.clock(dto, clientIp(req));
  }

  /** The person's own kiosk PIN. */
  @Put('attendance-pin')
  setAttendancePin(@Body() dto: SetAttendancePinDto) {
    return this.me.setAttendancePin(dto.pin);
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

  /** Withdraw my own leave request while nobody has decided it. */
  @Post('leave/:id/cancel')
  cancelLeave(@Param('id') id: string) {
    return this.me.cancelLeave(id);
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

  /** Withdraw my own claim while nobody has decided it. */
  @Patch('contact')
  updateContact(@Body() dto: UpdateMyContactDto) {
    return this.me.updateContact(dto);
  }

  @Get('bank-change')
  bankChange() {
    return this.me.bankChange();
  }

  @Post('bank-change')
  requestBankChange(@Body() dto: RequestBankChangeDto) {
    return this.me.requestBankChange(dto);
  }

  @Post('bank-change/:id/cancel')
  cancelBankChange(@Param('id') id: string) {
    return this.me.cancelBankChange(id);
  }

  @Post('claims/:id/cancel')
  cancelClaim(@Param('id') id: string) {
    return this.me.cancelClaim(id);
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
    const pdf = await renderPayslipPdf(slip, await this.me.payslipLogo(slip.employer.logoMediaId));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${slip.period}.pdf"`);
    res.send(pdf);
  }
}
