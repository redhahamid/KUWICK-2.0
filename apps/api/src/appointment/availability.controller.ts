import { Controller, Get, Query } from '@nestjs/common';
import { SlotAvailabilityService } from './slot-availability.service';
import { parseDateOnly } from './time.util';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly slotAvailability: SlotAvailabilityService) {}

  @Get()
  findAvailableSlots(
    @Query('staffId') staffId: string,
    @Query('clinicId') clinicId: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
  ) {
    return this.slotAvailability.findAvailableSlots({
      staffId,
      clinicId,
      serviceId,
      date: parseDateOnly(date),
    });
  }
}
