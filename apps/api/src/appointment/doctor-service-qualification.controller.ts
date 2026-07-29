import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { DoctorServiceQualificationService } from './doctor-service-qualification.service';
import { CreateDoctorServiceQualificationDto } from './dto/create-doctor-service-qualification.dto';

@Controller('doctor-service-qualifications')
export class DoctorServiceQualificationController {
  constructor(private readonly qualifications: DoctorServiceQualificationService) {}

  @Post()
  create(@Body() dto: CreateDoctorServiceQualificationDto) {
    return this.qualifications.create(dto);
  }

  @Get()
  findAll(@Query('staffId') staffId?: string) {
    return this.qualifications.findAll({ staffId });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.qualifications.remove(id);
  }
}
