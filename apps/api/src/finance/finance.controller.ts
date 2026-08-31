import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreditNoteStatus, SupplierInvoiceStatus } from '@prisma/client';
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
import { OptionalDateParam, RequiredDateParam } from '../core/date-param.pipe';
import { assertDateOrder } from '../core/query-dates';
import { ProfitabilityKind, ProfitabilityService } from './profitability.service';
import { SupplierPayablesService } from './supplier-payables.service';
import { PanelMoneyService } from './panel-money.service';
import {
  RecordSupplierInvoiceDto,
  RecordSupplierPaymentDto,
  UpdateSupplierInvoiceDto,
  UpdateSupplierTermsDto,
} from './dto/supplier-payable.dto';

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
    private readonly profit: ProfitabilityService,
    private readonly payables_: SupplierPayablesService,
    private readonly panelMoney: PanelMoneyService,
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
  paymentReport(@Query('from', RequiredDateParam) from: string, @Query('to', RequiredDateParam) to: string, @Query('clinicId') clinicId?: string) {
    assertDateOrder(from, to);
    return this.receivables.paymentReport({ from, to, clinicId });
  }

  // --- Receivables ----------------------------------------------------------

  @Get('receivables/patients')
  patientReceivables(
    @Query('clinicId') clinicId?: string,
    @Query('asOf', OptionalDateParam) asOf?: string,
    @Query('includeSettled') includeSettled?: string,
  ) {
    return this.receivables.patientReceivables({ clinicId, asOf, includeSettled: includeSettled === 'true' });
  }

  // --- Day end --------------------------------------------------------------

  @Get('day-end')
  dayEndView(@Query('date', RequiredDateParam) date: string, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.view(clinicId, date);
  }

  @Get('day-end/range')
  dayEndRange(@Query('from', RequiredDateParam) from: string, @Query('to', RequiredDateParam) to: string, @Query('clinicId') clinicId?: string) {
    assertDateOrder(from, to);
    return this.dayEnd.listRange(clinicId, from, to);
  }

  @Get('day-end/open')
  openDays(@Query('clinicId') clinicId?: string) {
    return this.dayEnd.openDays(clinicId);
  }

  @Post('day-end/count')
  count(@Query('date', RequiredDateParam) date: string, @Body() dto: CountDayEndDto, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.count(clinicId, date, dto);
  }

  @Post('day-end/close')
  close(@Query('date', RequiredDateParam) date: string, @Body() dto: CloseDayEndDto, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.close(clinicId, date, dto);
  }

  @Post('day-end/reopen')
  reopen(@Query('date', RequiredDateParam) date: string, @Body() dto: ReopenDayEndDto, @Query('clinicId') clinicId?: string) {
    return this.dayEnd.reopen(clinicId, date, dto);
  }

  // --- Credit notes ---------------------------------------------------------

  @Get('credit-notes')
  listCreditNotes(
    @Query('clinicId') clinicId?: string,
    @Query('status') status?: CreditNoteStatus,
    @Query('from', OptionalDateParam) from?: string,
    @Query('to', OptionalDateParam) to?: string,
  ) {
    assertDateOrder(from, to);
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
  taxReport(@Query('from', RequiredDateParam) from: string, @Query('to', RequiredDateParam) to: string, @Query('clinicId') clinicId?: string) {
    assertDateOrder(from, to);
    return this.tax.report({ from, to, clinicId });
  }

  // --- Accounts payable -------------------------------------------------------
  //
  // The one question the clinic could not ask Kuwick: what do we owe suppliers.
  // See finance/supplier-payables.ts for why the arithmetic lives in one place.

  @Get('payables')
  payables(@Query('asOf') asOf?: string) {
    return this.payables_.summary({ asOf });
  }

  @Get('payables/invoices')
  payableInvoices(
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: SupplierInvoiceStatus,
    @Query('asOf') asOf?: string,
  ) {
    return this.payables_.invoices({ supplierId, status, asOf });
  }

  @Get('payables/payments')
  supplierPayments(@Query('supplierId') supplierId?: string) {
    return this.payables_.payments({ supplierId });
  }

  @Post('payables/invoices')
  recordSupplierInvoice(@Body() dto: RecordSupplierInvoiceDto) {
    return this.payables_.recordInvoice(dto);
  }

  @Patch('payables/invoices/:id')
  updateSupplierInvoice(@Param('id') id: string, @Body() dto: UpdateSupplierInvoiceDto) {
    return this.payables_.updateInvoice(id, dto);
  }

  @Post('payables/payments')
  recordSupplierPayment(@Body() dto: RecordSupplierPaymentDto) {
    return this.payables_.recordPayment(dto);
  }

  @Patch('payables/suppliers/:id/terms')
  updateSupplierTerms(@Param('id') id: string, @Body() dto: UpdateSupplierTermsDto) {
    return this.payables_.updateTerms(id, dto);
  }

  // --- Panel money ------------------------------------------------------------
  //
  // The finance side of the panel relationship: billed vs claimed, what the
  // admin fee costs, and what the panels actually banked. See
  // finance/panel-money.ts for why each of the three is a separate question.

  @Get('panel-money')
  panelMoneyPosition(
    @Query('from', OptionalDateParam) from?: string,
    @Query('to', OptionalDateParam) to?: string,
    @Query('clinicId') clinicId?: string,
    @Query('panelClinicId') panelClinicId?: string,
  ) {
    assertDateOrder(from, to);
    return this.panelMoney.position({ from, to, clinicId, panelClinicId });
  }

  // --- Profitability ----------------------------------------------------------

  @Get('profitability')
  profitability(
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
    @Query('clinicId') clinicId?: string,
    @Query('kind') kind?: ProfitabilityKind,
  ) {
    assertDateOrder(from, to);
    return this.profit.report({ from, to, clinicId, kind });
  }
}
