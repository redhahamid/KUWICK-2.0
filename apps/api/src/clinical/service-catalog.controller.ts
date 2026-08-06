import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ServiceCatalogService } from './service-catalog.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';

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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceCatalog.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.serviceCatalog.update(id, dto);
  }
}
