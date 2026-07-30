import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { OrderServiceStatus } from '@prisma/client';
import { OrderServiceService } from './order-service.service';
import { CompleteOrderServiceDto } from './dto/complete-order-service.dto';

// The standalone Procedure Task Queue (docs/PRODUCT_REQUIREMENTS.md §4,
// Clinical 2c plan) — a cross-visit, TASK_ORDER-only read of OrderService.
// "Complete" is the only action, matching the audited kuwick.com reference
// (D-023 precedent); Start/Cancel live on the per-visit Orders & Services
// tab instead.
@Controller('procedure-queue')
export class ProcedureQueueController {
  constructor(private readonly orderServices: OrderServiceService) {}

  @Get()
  find(@Query('clinicId') clinicId?: string, @Query('status') status?: OrderServiceStatus) {
    return this.orderServices.procedureQueue({ clinicId, status });
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteOrderServiceDto) {
    return this.orderServices.complete(id, dto);
  }
}
