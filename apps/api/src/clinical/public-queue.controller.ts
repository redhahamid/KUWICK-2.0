import { Controller, Get, Param } from '@nestjs/common';
import { PublicQueueService } from './public-queue.service';

// Excluded from TenantContextMiddleware (AppModule) — the waiting-room TV
// has no login; PublicQueueService bounds what this can expose (numbers
// and room names only, no PII).
@Controller('public/queue')
export class PublicQueueController {
  constructor(private readonly publicQueue: PublicQueueService) {}

  @Get(':clinicId')
  getMonitorData(@Param('clinicId') clinicId: string) {
    return this.publicQueue.getMonitorData(clinicId);
  }
}
