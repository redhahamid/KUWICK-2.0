import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { OperationsController } from './analytics.controller';
import { OperationsService } from './operations.service';
import { SegmentService } from './segment.service';
import { ProgrammeService } from './programme.service';
import { MarketingService } from './marketing.service';

/**
 * WAVE 5 of the admin programme.
 *
 * Read-only over every other module's tables, plus its own configuration:
 * segments, mapping rules, programmes, marketing templates and dispatches. It
 * writes nothing that another module owns, which is why it can safely read
 * across all of them.
 */
@Module({
  imports: [CoreModule],
  controllers: [OperationsController],
  providers: [OperationsService, SegmentService, ProgrammeService, MarketingService],
  exports: [OperationsService, SegmentService],
})
export class AnalyticsModule {}
