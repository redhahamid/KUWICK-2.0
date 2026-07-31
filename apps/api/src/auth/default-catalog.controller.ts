import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import { DefaultCatalogService } from './default-catalog.service';
import { CreateDefaultPanelClinicDto } from './dto/create-default-panel-clinic.dto';
import { UpdateDefaultPanelClinicDto } from './dto/update-default-panel-clinic.dto';
import { CreateDefaultProcedureDto } from './dto/create-default-procedure.dto';
import { UpdateDefaultProcedureDto } from './dto/update-default-procedure.dto';

@Controller('platform/defaults')
@UseGuards(PlatformAuthGuard)
export class DefaultCatalogController {
  constructor(private readonly catalogs: DefaultCatalogService) {}

  @Get('panel-clinics')
  listPanelClinics() {
    return this.catalogs.listPanelClinics();
  }

  @Post('panel-clinics')
  createPanelClinic(@Body() dto: CreateDefaultPanelClinicDto) {
    return this.catalogs.createPanelClinic(dto);
  }

  @Patch('panel-clinics/:id')
  updatePanelClinic(@Param('id') id: string, @Body() dto: UpdateDefaultPanelClinicDto) {
    return this.catalogs.updatePanelClinic(id, dto);
  }

  @Delete('panel-clinics/:id')
  removePanelClinic(@Param('id') id: string) {
    return this.catalogs.removePanelClinic(id);
  }

  @Get('procedures')
  listProcedures() {
    return this.catalogs.listProcedures();
  }

  @Post('procedures')
  createProcedure(@Body() dto: CreateDefaultProcedureDto) {
    return this.catalogs.createProcedure(dto);
  }

  @Patch('procedures/:id')
  updateProcedure(@Param('id') id: string, @Body() dto: UpdateDefaultProcedureDto) {
    return this.catalogs.updateProcedure(id, dto);
  }

  @Delete('procedures/:id')
  removeProcedure(@Param('id') id: string) {
    return this.catalogs.removeProcedure(id);
  }
}
