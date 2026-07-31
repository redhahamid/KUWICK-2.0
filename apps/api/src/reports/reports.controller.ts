import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
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

  // ------ Report suite (D-039), built to the owner's Power BI file ------

  @Get('day-end')
  getDayEnd(@Query('date') date?: string, @Query('clinicId') clinicId?: string) {
    if (!date) {
      throw new BadRequestException('date is required (YYYY-MM-DD)');
    }
    return this.reports.getDayEndSummary(clinicId, date);
  }

  @Get('sales-analysis')
  getSalesAnalysis(@Query('from') from?: string, @Query('to') to?: string, @Query('clinicId') clinicId?: string) {
    return this.reports.getSalesAnalysis({ from, to, clinicId });
  }

  @Get('patient-analysis')
  getPatientAnalysis(@Query('from') from?: string, @Query('to') to?: string, @Query('clinicId') clinicId?: string) {
    return this.reports.getPatientAnalysis({ from, to, clinicId });
  }

  @Get('procedure-analysis')
  getProcedureAnalysis(@Query('from') from?: string, @Query('to') to?: string, @Query('clinicId') clinicId?: string) {
    return this.reports.getProcedureAnalysis({ from, to, clinicId });
  }

  @Get('doctor-performance-detailed')
  getDoctorPerformanceDetailed(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('clinicId') clinicId?: string,
  ) {
    return this.reports.getDoctorPerformanceDetailed({ from, to, clinicId });
  }

  @Get('invoices')
  getInvoiceListing(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('clinicId') clinicId?: string,
    @Query('status') status?: InvoiceStatus,
  ) {
    return this.reports.getInvoiceListing({ from, to, clinicId }, status);
  }
}
