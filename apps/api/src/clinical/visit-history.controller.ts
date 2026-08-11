import { Controller, Get, Param, Query } from '@nestjs/common';
import { VisitHistoryService } from './visit-history.service';

/**
 * G4 (D-067) — the read-only clinical history API.
 *
 * Only GETs exist on this controller, and the service behind it has no
 * mutation method at all. The patient id is part of the path on both routes
 * so that every read states which chart it belongs to and can be checked
 * against the visit's stored `patientId`.
 */
@Controller('patients/:patientId/history')
export class VisitHistoryController {
  constructor(private readonly history: VisitHistoryService) {}

  @Get()
  list(
    @Param('patientId') patientId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.history.listForPatient(patientId, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      search: search?.trim() || undefined,
      from,
      to,
      staffId,
    });
  }

  @Get(':visitId')
  detail(@Param('patientId') patientId: string, @Param('visitId') visitId: string) {
    return this.history.findForPatient(patientId, visitId);
  }
}
