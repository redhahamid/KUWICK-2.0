import { Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { PatientAlertService } from './patient-alert.service';
import { CreatePatientAlertDto } from './dto/create-patient-alert.dto';

// A2 — patient alerts. Same scoped-pipe reasoning as the other clinical
// controllers: a client posting createdByStaffId must fail loudly with a
// 400, never have the field stripped and believe it set the author.
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller()
export class PatientAlertController {
  constructor(private readonly alerts: PatientAlertService) {}

  @Get('patients/:patientId/alerts')
  list(@Param('patientId') patientId: string) {
    return this.alerts.listByPatient(patientId);
  }

  @Post('patients/:patientId/alerts')
  create(@Param('patientId') patientId: string, @Body() dto: CreatePatientAlertDto) {
    return this.alerts.create(patientId, dto);
  }

  // Deactivate, never delete — there deliberately is no DELETE route, and
  // the table has no DELETE policy for anyone who goes looking for one.
  @Patch('patient-alerts/:id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.alerts.deactivate(id);
  }
}
