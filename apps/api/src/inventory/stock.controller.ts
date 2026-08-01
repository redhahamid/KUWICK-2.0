import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import { SetStockMinThresholdDto } from './dto/set-stock-min-threshold.dto';
import { QuickAddStockDto } from './dto/quick-add-stock.dto';
import { StockTakeDto } from './dto/stock-take.dto';

@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('levels')
  listLevels(@Query('clinicId') clinicId?: string) {
    return this.stockService.listLevels(clinicId);
  }

  @Get('low-stock')
  listLowStock(@Query('clinicId') clinicId?: string) {
    return this.stockService.listLowStock(clinicId);
  }

  @Get('negative-stock')
  listNegativeStock(@Query('clinicId') clinicId?: string) {
    return this.stockService.listNegativeStock(clinicId);
  }

  @Get('batches')
  listBatches(@Query('clinicId') clinicId?: string, @Query('itemId') itemId?: string) {
    return this.stockService.listBatches(clinicId, itemId);
  }

  @Get('movements')
  listMovements(@Query('clinicId') clinicId?: string, @Query('itemId') itemId?: string) {
    return this.stockService.listMovements(clinicId, itemId);
  }

  @Get('near-expiry')
  listNearExpiry(@Query('clinicId') clinicId?: string, @Query('withinDays') withinDays?: string) {
    return this.stockService.listNearExpiry(clinicId, withinDays ? Number(withinDays) : undefined);
  }

  @Post('min-threshold')
  setMinThreshold(@Body() dto: SetStockMinThresholdDto) {
    return this.stockService.setMinThreshold(dto);
  }

  @Post('quick-add')
  quickAdd(@Body() dto: QuickAddStockDto) {
    return this.stockService.quickAdd(dto);
  }

  @Post('stock-take')
  performStockTake(@Body() dto: StockTakeDto) {
    return this.stockService.performStockTake(dto);
  }
}
