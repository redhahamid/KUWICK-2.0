import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { CoreModule } from '../core/core.module';
import { WorkforceModule } from '../workforce/workforce.module';

/**
 * The employee-facing module.
 *
 * It owns no table of its own on purpose. Every read and write goes to the
 * canonical rows the administrative side already uses — the same roster, the
 * same attendance records, the same leave requests, the same claims. A
 * self-service copy of any of them would be a second answer to a question that
 * already has one.
 */
@Module({
  imports: [CoreModule, WorkforceModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
