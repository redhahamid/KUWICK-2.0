import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ServiceCatalogService } from './service-catalog.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Controller('services')
export class ServiceCatalogController {
  constructor(private readonly serviceCatalog: ServiceCatalogService) {}

  @Post()
  create(@Body() dto: CreateServiceDto) {
    return this.serviceCatalog.create(dto);
  }

  @Get()
  findAll() {
    return this.serviceCatalog.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceCatalog.findById(id);
  }
}
