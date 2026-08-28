import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { StockTransferStatus } from '@prisma/client';
import { StockAdminService } from './stock-admin.service';
import { StockTransferService } from './stock-transfer.service';
import { StockTakeService } from './stock-take.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { ReceiveStockTransferDto } from './dto/receive-stock-transfer.dto';
import { CancelStockTransferDto } from './dto/cancel-stock-transfer.dto';
import { CreateStockTakeDto } from './dto/create-stock-take.dto';
import { RecordCountDto } from './dto/record-count.dto';
import { ReviewStockTakeDto } from './dto/review-stock-take.dto';

@Controller('stock-admin')
export class StockAdminController {
  constructor(
    private readonly admin: StockAdminService,
    private readonly transfers: StockTransferService,
    private readonly takes: StockTakeService,
  ) {}

  // --- The homepage: what needs attention today ----------------------------

  @Get('exceptions')
  exceptions(@Query('clinicId') clinicId?: string) {
    return this.admin.exceptions(clinicId);
  }

  @Get('exceptions/:kind')
  exceptionRows(@Param('kind') kind: string, @Query('clinicId') clinicId?: string) {
    return this.admin.exceptionRows(kind, clinicId);
  }

  @Get('valuation')
  valuation(@Query('clinicId') clinicId?: string) {
    return this.admin.valuation(clinicId);
  }

  @Get('movements')
  movements(
    @Query('clinicId') clinicId?: string,
    @Query('itemId') itemId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.movements({ clinicId, itemId, from, to, limit: limit ? Number(limit) : undefined });
  }

  @Post('adjustments')
  adjust(@Body() dto: AdjustStockDto) {
    return this.admin.adjust(dto);
  }

  // --- Transfers ------------------------------------------------------------

  @Get('transfers')
  listTransfers(
    @Query('clinicId') clinicId?: string,
    @Query('status') status?: StockTransferStatus,
    @Query('direction') direction?: 'IN' | 'OUT',
  ) {
    return this.transfers.list({ clinicId, status, direction });
  }

  @Post('transfers')
  createTransfer(@Body() dto: CreateStockTransferDto) {
    return this.transfers.create(dto);
  }

  @Patch('transfers/:id/send')
  sendTransfer(@Param('id') id: string) {
    return this.transfers.send(id);
  }

  @Patch('transfers/:id/receive')
  receiveTransfer(@Param('id') id: string, @Body() dto: ReceiveStockTransferDto) {
    return this.transfers.receive(id, dto);
  }

  @Patch('transfers/:id/cancel')
  cancelTransfer(@Param('id') id: string, @Body() dto: CancelStockTransferDto) {
    return this.transfers.cancel(id, dto);
  }

  // --- Stock takes ----------------------------------------------------------

  @Get('stock-takes')
  listTakes(@Query('clinicId') clinicId?: string) {
    return this.takes.list(clinicId);
  }

  @Get('stock-takes/:id')
  takeDetail(@Param('id') id: string) {
    return this.takes.detail(id);
  }

  @Post('stock-takes')
  createTake(@Body() dto: CreateStockTakeDto) {
    return this.takes.create(dto);
  }

  @Patch('stock-takes/:id/counts')
  recordCounts(@Param('id') id: string, @Body() dto: RecordCountDto) {
    return this.takes.recordCounts(id, dto);
  }

  @Patch('stock-takes/:id/submit')
  submitTake(@Param('id') id: string) {
    return this.takes.submit(id);
  }

  @Patch('stock-takes/:id/approve')
  approveTake(@Param('id') id: string, @Body() dto: ReviewStockTakeDto) {
    return this.takes.approve(id, dto);
  }

  @Patch('stock-takes/:id/cancel')
  cancelTake(@Param('id') id: string, @Body() dto: CancelStockTransferDto) {
    return this.takes.cancel(id, dto.reason);
  }
}
