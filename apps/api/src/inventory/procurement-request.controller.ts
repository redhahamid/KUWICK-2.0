import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProcurementRequestStatus } from '@prisma/client';
import { ProcurementRequestService } from './procurement-request.service';
import { CreateProcurementRequestDto } from './dto/create-procurement-request.dto';

@Controller('procurement-requests')
export class ProcurementRequestController {
  constructor(private readonly procurementRequestService: ProcurementRequestService) {}

  @Post()
  create(@Body() dto: CreateProcurementRequestDto) {
    return this.procurementRequestService.create(dto);
  }

  @Get()
  findAll(@Query('clinicId') clinicId?: string, @Query('status') status?: ProcurementRequestStatus) {
    return this.procurementRequestService.findAll({ clinicId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.procurementRequestService.findById(id);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.procurementRequestService.approve(id);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.procurementRequestService.reject(id);
  }
}
