import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ServiceCatalogService } from './service-catalog.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { UpdateServiceBookingDto } from './dto/update-service-booking.dto';

@Controller('services')
export class ServiceCatalogController {
  constructor(private readonly serviceCatalog: ServiceCatalogService) {}

  @Post()
  create(@Body() dto: CreateServiceDto) {
    return this.serviceCatalog.create(dto);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('take') take?: string,
    @Query('orderType') orderType?: string,
  ) {
    const parsed = take ? Number(take) : undefined;
    return this.serviceCatalog.findAll(search, Number.isFinite(parsed) ? parsed : undefined, orderType);
  }

  // Before `:id`, or Nest reads "bookable" as an id and answers 404.
  @Get('bookable')
  bookable() {
    return this.serviceCatalog.bookable();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceCatalog.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.serviceCatalog.update(id, dto);
  }

  @Patch(':id/booking')
  updateBooking(@Param('id') id: string, @Body() dto: UpdateServiceBookingDto) {
    return this.serviceCatalog.updateBooking(id, dto);
  }
}
