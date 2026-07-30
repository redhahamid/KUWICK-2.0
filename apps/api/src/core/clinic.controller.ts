import { Body, Controller, Get, Post } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { CreateClinicDto } from './dto/create-clinic.dto';

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
}
