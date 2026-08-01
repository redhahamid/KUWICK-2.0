import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VisitService } from './visit.service';
import { CreateVisitDto } from './dto/create-visit.dto';

@Controller('visits')
export class VisitController {
  constructor(private readonly visits: VisitService) {}

  // Patient Dashboard's "New Visit" — creates a Visit with no queue ticket,
  // for a patient who needs a medical record entry outside the front-desk
  // queue flow (e.g. a doctor-initiated follow-up).
  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto);
  }

  @Get()
  findAll(@Query('clinicId') clinicId?: string, @Query('patientId') patientId?: string) {
    return this.visits.findAll({ clinicId, patientId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findById(id);
  }
}
