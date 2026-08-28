import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { PanelWorkspaceController } from './panel.controller';
import { ClaimWorkspaceService } from './claim-workspace.service';
import { PanelConfigService } from './panel-config.service';

/**
 * WAVE 3 of the admin programme.
 *
 * Owns the claim LIFECYCLE, remittances and the claim timeline. It does not own
 * batch CREATION — `ClaimBatchService` in the clinical module has done that
 * since Phase 1e, and it knows the panel-covered amount and the fee rules. Two
 * modules that both create claims would be two answers to "what did we claim".
 */
@Module({
  imports: [CoreModule],
  controllers: [PanelWorkspaceController],
  providers: [ClaimWorkspaceService, PanelConfigService],
  exports: [ClaimWorkspaceService],
})
export class PanelModule {}
