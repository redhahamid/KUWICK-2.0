import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { PurchaseOrderService } from './purchase-order.service';
import { GoodsReceivingService } from './goods-receiving.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly goodsReceivingService: GoodsReceivingService,
  ) {}

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrderService.create(dto);
  }

  @Get()
  findAll(@Query('clinicId') clinicId?: string, @Query('status') status?: PurchaseOrderStatus) {
    return this.purchaseOrderService.findAll({ clinicId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrderService.findById(id);
  }

  @Post(':id/receive')
  receive(@Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto) {
    return this.goodsReceivingService.receive(id, dto);
  }
}
