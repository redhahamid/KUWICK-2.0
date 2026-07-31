import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PanelClinicService } from './panel-clinic.service';
import { CreatePanelClinicDto, UpdatePanelClinicDto } from './dto/create-panel-clinic.dto';

@Controller('panel-clinics')
export class PanelClinicController {
  constructor(private readonly panelClinics: PanelClinicService) {}

  @Post()
  create(@Body() dto: CreatePanelClinicDto) {
    return this.panelClinics.create(dto);
  }

  @Get()
  findAll(@Query('activeOnly') activeOnly?: string) {
    return this.panelClinics.findAll(activeOnly === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.panelClinics.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePanelClinicDto) {
    return this.panelClinics.update(id, dto);
  }
}
