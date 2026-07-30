import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { ItemController } from './item.controller';
import { ItemService } from './item.service';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { ProcurementRequestController } from './procurement-request.controller';
import { ProcurementRequestService } from './procurement-request.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { GoodsReceivingService } from './goods-receiving.service';

// Inventory & Procurement, Phase 1d (docs/DEVELOPMENT_ROADMAP.md). Owns
// Item/Stock (docs/PRODUCT_REQUIREMENTS.md §9 data-ownership table) — Item
// and Stock services are exported for Clinical Operations to read from once
// it's built; no other module writes to Inventory's tables directly
// (docs/CODING_STANDARDS.md §3).
@Module({
  imports: [CoreModule],
  controllers: [
    ItemController,
    SupplierController,
    StockController,
    ProcurementRequestController,
    PurchaseOrderController,
  ],
  providers: [
    ItemService,
    SupplierService,
    StockService,
    ProcurementRequestService,
    PurchaseOrderService,
    GoodsReceivingService,
  ],
  exports: [ItemService, StockService],
})
export class InventoryModule {}
