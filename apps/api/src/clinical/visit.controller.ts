import { Controller, Get, Param, Query } from '@nestjs/common';
import { VisitService } from './visit.service';

@Controller('visits')
export class VisitController {
  constructor(private readonly visits: VisitService) {}

  @Get()
  findAll(@Query('clinicId') clinicId?: string, @Query('patientId') patientId?: string) {
    return this.visits.findAll({ clinicId, patientId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findById(id);
  }
}
