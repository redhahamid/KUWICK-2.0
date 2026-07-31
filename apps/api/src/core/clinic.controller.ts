import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { CreateClinicDto, UpdateClinicDto } from './dto/create-clinic.dto';

@Controller('clinics')
export class ClinicController {
  constructor(private readonly clinics: ClinicService) {}

  @Post()
  create(@Body() dto: CreateClinicDto) {
    return this.clinics.create(dto);
  }

  @Get()
  findAll() {
    return this.clinics.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClinicDto) {
    return this.clinics.update(id, dto);
  }
}
