import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformTenantService } from './platform-tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

// Excluded from TenantContextMiddleware (AppModule) — guarded instead by
// PlatformAuthGuard, since these routes manage tenants themselves and have
// no tenant context of their own.
@Controller('platform/tenants')
@UseGuards(PlatformAuthGuard)
export class PlatformTenantController {
  constructor(private readonly tenants: PlatformTenantService) {}

  @Get()
  findAll() {
    return this.tenants.findAll();
  }

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }
}
