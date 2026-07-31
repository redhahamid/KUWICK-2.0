import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { AddInvoiceLineDto } from './dto/add-invoice-line.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
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

  @Delete(':id/lines/:lineId')
  removeLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.invoices.removeLine(id, lineId);
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
