import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PrescriptionService } from './prescription.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { CancelPrescriptionDto } from './dto/cancel-prescription.dto';
import { CopyPrescriptionsDto } from './dto/copy-prescriptions.dto';
import { UpdateSupplyModeDto } from './dto/update-supply-mode.dto';

@Controller('prescriptions')
export class PrescriptionController {
  constructor(private readonly prescriptions: PrescriptionService) {}

  @Get()
  findByVisit(@Query('visitId') visitId: string) {
    return this.prescriptions.findByVisitId(visitId);
  }

  @Get('copy-sources')
  findCopySources(@Query('patientId') patientId: string, @Query('excludeVisitId') excludeVisitId?: string) {
    return this.prescriptions.findVisitsWithPrescriptions(patientId, excludeVisitId);
  }

  @Post()
  create(@Body() dto: CreatePrescriptionDto) {
    return this.prescriptions.create(dto);
  }

  @Post('copy')
  copy(@Body() dto: CopyPrescriptionsDto) {
    return this.prescriptions.copyFromVisit(dto);
  }

  // G4.5d3c-3a1 (D-091) — supply intent only; nothing else on the row is
  // writable through this route.
  @Patch(':id/supply-mode')
  setSupplyMode(@Param('id') id: string, @Body() dto: UpdateSupplyModeDto) {
    return this.prescriptions.setSupplyMode(id, dto);
  }

  @Patch(':id/dispense')
  dispense(@Param('id') id: string) {
    return this.prescriptions.dispense(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelPrescriptionDto) {
    return this.prescriptions.cancel(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prescriptions.remove(id);
  }
}
