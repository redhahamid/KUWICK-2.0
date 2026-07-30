import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import { OrderServiceService } from './order-service.service';
import { CreateOrderServiceDto } from './dto/create-order-service.dto';
import { CompleteOrderServiceDto } from './dto/complete-order-service.dto';
import { CancelOrderServiceDto } from './dto/cancel-order-service.dto';

@Controller('order-services')
export class OrderServiceController {
  constructor(private readonly orderServices: OrderServiceService) {}

  @Get()
  findByVisit(
    @Query('visitId') visitId: string,
    @Query('orderType') orderType?: ServiceOrderType,
    @Query('status') status?: OrderServiceStatus,
  ) {
    return this.orderServices.findByVisitId(visitId, { orderType, status });
  }

  @Post()
  create(@Body() dto: CreateOrderServiceDto) {
    return this.orderServices.create(dto);
  }

  @Patch(':id/start')
  start(@Param('id') id: string) {
    return this.orderServices.start(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteOrderServiceDto) {
    return this.orderServices.complete(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelOrderServiceDto) {
    return this.orderServices.cancel(id, dto);
  }
}
