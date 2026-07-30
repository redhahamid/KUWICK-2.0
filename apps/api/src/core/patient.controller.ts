import { Body, Controller, Get, Post } from '@nestjs/common';
import { PatientService } from './patient.service';
import { CreatePatientDto } from './dto/create-patient.dto';

@Controller('patients')
export class PatientController {
  constructor(private readonly patients: PatientService) {}

  @Post()
  create(@Body() dto: CreatePatientDto) {
    return this.patients.create(dto);
  }

  @Get()
  findAll() {
    return this.patients.findAll();
  }
}
