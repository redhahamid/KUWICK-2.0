import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  getSales(@Query('from') from?: string, @Query('to') to?: string, @Query('clinicId') clinicId?: string) {
    return this.reports.getSalesSummary({ from, to, clinicId });
  }

  @Get('appointments')
  getAppointments(@Query('from') from?: string, @Query('to') to?: string, @Query('clinicId') clinicId?: string) {
    return this.reports.getAppointmentAnalytics({ from, to, clinicId });
  }

  @Get('doctor-performance')
  getDoctorPerformance(@Query('from') from?: string, @Query('to') to?: string, @Query('clinicId') clinicId?: string) {
    return this.reports.getDoctorPerformance({ from, to, clinicId });
  }

  @Get('panel-aging')
  getPanelAging() {
    return this.reports.getPanelAging();
  }
}
