import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import { SetStockMinThresholdDto } from './dto/set-stock-min-threshold.dto';

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

  @Post('min-threshold')
  setMinThreshold(@Body() dto: SetStockMinThresholdDto) {
    return this.stockService.setMinThreshold(dto);
  }
}
