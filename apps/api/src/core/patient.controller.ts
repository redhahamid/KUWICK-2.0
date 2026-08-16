import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PatientService } from './patient.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Controller('patients')
export class PatientController {
  constructor(private readonly patients: PatientService) {}

  @Post()
  create(@Body() dto: CreatePatientDto) {
    return this.patients.create(dto);
  }

  @Get()
  findAll(@Query('search') search?: string) {
    return this.patients.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patients.findById(id);
  }

  /**
   * What an identity correction on this patient would reach.
   *
   * Its own read, taken before the confirmation is shown, rather than folded
   * into the patient payload every screen loads: the counts are three COUNT
   * queries, and the profile does not need them to render a phone number.
   */
  @Get(':id/identity-impact')
  identityImpact(@Param('id') id: string) {
    return this.patients.identityImpact(id);
  }

  /** Corrections already made — old value, new value, who, when. */
  @Get(':id/identity-history')
  identityHistory(@Param('id') id: string) {
    return this.patients.identityHistory(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patients.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.patients.remove(id);
  }
}
