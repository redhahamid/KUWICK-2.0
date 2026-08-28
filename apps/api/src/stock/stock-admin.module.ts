import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { StockAdminController } from './stock.controller';
import { StockAdminService } from './stock-admin.service';
import { StockTransferService } from './stock-transfer.service';
import { StockTakeService } from './stock-take.service';

/**
 * WAVE 2 of the admin programme.
 *
 * Owns `stock_transfers`, `stock_takes` and the structured-reason adjustment
 * path. It does NOT own items, stock levels, suppliers or purchase orders —
 * those stay with `InventoryModule`, which has run them since Phase 1. Both
 * modules write stock through the same `postMovement` in `stock-ledger.ts`, so
 * there is one write path into a stock level and not two.
 */
@Module({
  imports: [CoreModule],
  controllers: [StockAdminController],
  providers: [StockAdminService, StockTransferService, StockTakeService],
  exports: [StockAdminService, StockTransferService, StockTakeService],
})
export class StockAdminModule {}
