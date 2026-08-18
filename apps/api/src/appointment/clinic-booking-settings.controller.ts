import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ClinicBookingSettingsService } from './clinic-booking-settings.service';
import { UpsertClinicBookingSettingsDto } from './dto/upsert-clinic-booking-settings.dto';
import { CreateClinicClosedDateDto } from './dto/create-clinic-closed-date.dto';

@Controller('clinics/:clinicId/booking-settings')
export class ClinicBookingSettingsController {
  constructor(private readonly settings: ClinicBookingSettingsService) {}

  @Get()
  get(@Param('clinicId') clinicId: string) {
    return this.settings.get(clinicId);
  }

  @Put()
  upsert(@Param('clinicId') clinicId: string, @Body() dto: UpsertClinicBookingSettingsDto) {
    return this.settings.upsert(clinicId, dto);
  }

  @Get('closed-dates')
  listClosedDates(@Param('clinicId') clinicId: string, @Query('includePast') includePast?: string) {
    return this.settings.listClosedDates(clinicId, includePast === 'true');
  }

  @Post('closed-dates')
  addClosedDate(@Param('clinicId') clinicId: string, @Body() dto: CreateClinicClosedDateDto) {
    return this.settings.addClosedDate(clinicId, dto);
  }

  @Delete('closed-dates/:id')
  removeClosedDate(@Param('clinicId') clinicId: string, @Param('id') id: string) {
    return this.settings.removeClosedDate(clinicId, id);
  }
}
