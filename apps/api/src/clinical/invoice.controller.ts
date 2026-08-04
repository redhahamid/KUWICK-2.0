import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { AddInvoiceLineDto } from './dto/add-invoice-line.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { CancelInvoiceLineDto } from './dto/cancel-invoice-line.dto';
import { ApplyLineDiscountDto } from './dto/apply-line-discount.dto';
import { ApplyInvoiceDiscountDto } from './dto/apply-invoice-discount.dto';
import { PayInvoiceDto } from './dto/pay-invoice.dto';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  findByVisit(@Query('visitId') visitId: string) {
    return this.invoices.findByVisitId(visitId);
  }

  @Post()
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto);
  }

  @Post(':id/lines')
  addLine(@Param('id') id: string, @Body() dto: AddInvoiceLineDto) {
    return this.invoices.addLine(id, dto);
  }

  // G4.5d3c-3b1 (D-093) - the route survives, its semantics changed: the
  // line is CANCELLED (actor, timestamp, reason retained), never erased.
  // 3b2 (D-094): the reason is mandatory, and the action is CANCEL_LINE
  // (counter/finance/owner) rather than EDIT_LINES.
  @Delete(':id/lines/:lineId')
  cancelLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: CancelInvoiceLineDto,
  ) {
    return this.invoices.cancelLine(id, lineId, dto);
  }

  // G4.5d3c-3b2 (D-094) - the IDEMPOTENT consultation auto-add. Billing
  // Review invokes it on open; repeated and concurrent calls cannot create a
  // second charge (FOR UPDATE on the visit + one-active-line rule). A
  // dedicated write operation, deliberately NOT a side effect of a read.
  @Post(':id/ensure-consultation')
  ensureConsultation(@Param('id') id: string) {
    return this.invoices.ensureConsultationCharge(id);
  }

  // The EXPLICIT counter action for the owner-approved exceptions: an exempt
  // visit where a real consultation occurred, or a deliberate re-add after a
  // waiver. Still tariff-driven and server-priced.
  @Post(':id/consultation-charge')
  addConsultationCharge(@Param('id') id: string) {
    return this.invoices.addConsultationCharge(id);
  }

  // D-093 - discounts, owner/finance only, reason mandatory.
  @Patch(':id/lines/:lineId/discount')
  applyLineDiscount(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: ApplyLineDiscountDto,
  ) {
    return this.invoices.applyLineDiscount(id, lineId, dto);
  }

  @Patch(':id/discount')
  applyInvoiceDiscount(@Param('id') id: string, @Body() dto: ApplyInvoiceDiscountDto) {
    return this.invoices.applyInvoiceDiscount(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoices.cancel(id, dto);
  }

  @Patch(':id/pay')
  pay(@Param('id') id: string, @Body() dto: PayInvoiceDto) {
    return this.invoices.pay(id, dto);
  }
}
