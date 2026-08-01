import { Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { VisitObservationService } from './visit-observation.service';
import { CorrectObservationDto, RecordObservationDto } from './dto/visit-observation.dto';

// C0 (D-051). POST = a NEW reading (repeat vitals during the same visit);
// PATCH = correcting an inaccurate entry, which requires a reason and
// preserves the previous values in an immutable revision. There is no delete.
//
// forbidNonWhitelisted: a client trying to post recordedByStaffId gets a 400
// rather than having it silently ignored. Recorder identity comes from the
// authenticated session only.
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('visits/:visitId/observations')
export class VisitObservationController {
  constructor(private readonly observations: VisitObservationService) {}

  @Get()
  list(@Param('visitId') visitId: string) {
    return this.observations.listByVisitId(visitId);
  }

  @Post()
  record(@Param('visitId') visitId: string, @Body() dto: RecordObservationDto) {
    return this.observations.record(visitId, dto);
  }

  @Patch(':id')
  correct(@Param('id') id: string, @Body() dto: CorrectObservationDto) {
    return this.observations.correct(id, dto);
  }

  @Get(':id/revisions')
  revisions(@Param('id') id: string) {
    return this.observations.listRevisions(id);
  }
}
