import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreditNoteStatus } from '@prisma/client';
import { PaymentService } from './payment.service';
import { CreditNoteService } from './credit-note.service';
import { DayEndService } from './day-end.service';
import { TaxService } from './tax.service';
import { ReceivablesService } from './receivables.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { CountDayEndDto } from './dto/count-day-end.dto';
import { CloseDayEndDto } from './dto/close-day-end.dto';
import { ReopenDayEndDto } from './dto/reopen-day-end.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { VoidCreditNoteDto } from './dto/void-credit-note.dto';
import { UpsertTaxCodeDto } from './dto/upsert-tax-code.dto';
import { AddTaxRateDto } from './dto/add-tax-rate.dto';

/**
 * Every route here is authorised INSIDE the service, against a named
 * permission, not by a decorator on the method. Same convention as the
 * clinical controllers: the check needs the actor loaded from the database
 * inside the tenant transaction, and a guard that ran earlier cannot see it.
 */
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly payments: PaymentService,
    private readonly creditNotes: CreditNoteService,
    private readonly dayEnd: DayEndService,
    private readonly tax: TaxService,
    private readonly receivables: ReceivablesService,
  ) {}

  // --- Payments -------------------------------------------------------------

  @Get('invoices/:id/position')
  position(@Param('id') id: string) {
    return this.payments.invoicePosition(id);
  }

  @Post('invoices/:id/payments')
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto) {
    return this.payments.record(id, dto);
  }

  @Post('payments/:id/reverse')
  reversePayment(@Param('id') id: string, @Body() dto: ReversePaymentDto) {
    return this.payments.reverse(id, dto);
  }

  @Get('payments')
  paymentReport(@Query('from') from: string, @Query('to') to: string, @Query('clinicId') clinicId?: string) {
    return this.receivables.paymentReport({ from, to, clinicId });
  }

  // --- Receivables ----------------------------------------------------------

  @Get('receivables/patients')
  patientReceivables(
    @Query('clinicId') clinicId?: string,
    @Query('asOf') asOf?: string,
    @Query('includeSettled') includeSettled?: string,
  ) {
    return this.receivables.patientReceivables({ clinicId, asOf, includeSettled: includeSettled === 'true' });
  }

  // --- Day end --------------------------------------------------------------

  @Get('day-end')
  dayEndView(@Query('date') date: string, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.view(clinicId, date);
  }

  @Get('day-end/range')
  dayEndRange(@Query('from') from: string, @Query('to') to: string, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.listRange(clinicId, from, to);
  }

  @Get('day-end/open')
  openDays(@Query('clinicId') clinicId?: string) {
    return this.dayEnd.openDays(clinicId);
  }

  @Post('day-end/count')
  count(@Query('date') date: string, @Body() dto: CountDayEndDto, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.count(clinicId, date, dto);
  }

  @Post('day-end/close')
  close(@Query('date') date: string, @Body() dto: CloseDayEndDto, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.close(clinicId, date, dto);
  }

  @Post('day-end/reopen')
  reopen(@Query('date') date: string, @Body() dto: ReopenDayEndDto, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.reopen(clinicId, date, dto);
  }

  // --- Credit notes ---------------------------------------------------------

  @Get('credit-notes')
  listCreditNotes(
    @Query('clinicId') clinicId?: string,
    @Query('status') status?: CreditNoteStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.creditNotes.list({ clinicId, status, from, to });
  }

  @Post('credit-notes')
  createCreditNote(@Body() dto: CreateCreditNoteDto) {
    return this.creditNotes.create(dto);
  }

  @Patch('credit-notes/:id/approve')
  approveCreditNote(@Param('id') id: string) {
    return this.creditNotes.approve(id);
  }

  @Patch('credit-notes/:id/void')
  voidCreditNote(@Param('id') id: string, @Body() dto: VoidCreditNoteDto) {
    return this.creditNotes.void(id, dto);
  }

  // --- Tax ------------------------------------------------------------------

  @Get('tax/codes')
  taxCodes() {
    return this.tax.listCodes();
  }

  @Post('tax/codes')
  upsertTaxCode(@Body() dto: UpsertTaxCodeDto) {
    return this.tax.upsertCode(dto);
  }

  @Post('tax/codes/:id/rates')
  addTaxRate(@Param('id') id: string, @Body() dto: AddTaxRateDto) {
    return this.tax.addRate(id, dto);
  }

  @Get('tax/report')
  taxReport(@Query('from') from: string, @Query('to') to: string, @Query('clinicId') clinicId?: string) {
    return this.tax.report({ from, to, clinicId });
  }
}
