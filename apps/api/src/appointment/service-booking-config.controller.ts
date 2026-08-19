import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ServiceBookingConfigService } from './service-booking-config.service';
import { UpdateServiceBookingConfigDto } from './dto/service-booking-config.dto';

@Controller('appointment-services')
export class ServiceBookingConfigController {
  constructor(private readonly services: ServiceBookingConfigService) {}

  @Get()
  list(
    @Query('bookableOnly') bookableOnly?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.services.list({ bookableOnly: bookableOnly === 'true', search, category });
  }

  // Literal path BEFORE `:id`.
  @Get('providers')
  eligibleProviders(@Query('clinicId') clinicId: string) {
    return this.services.eligibleProviders(clinicId);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.services.detail(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceBookingConfigDto) {
    return this.services.update(id, dto);
  }
}
