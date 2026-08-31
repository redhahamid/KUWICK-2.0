import { NewItemRequestController } from './new-item-request.controller';
import { NewItemRequestService } from './new-item-request.service';
import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { ItemController } from './item.controller';
import { ItemService } from './item.service';
import { ItemCategoryController } from './item-category.controller';
import { ItemCategoryService } from './item-category.service';
import { ItemPanelPricingService } from './item-panel-pricing.service';
import { InventoryImportService } from './inventory-import.service';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { ProcurementRequestController } from './procurement-request.controller';
import { ProcurementRequestService } from './procurement-request.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { GoodsReceivingService } from './goods-receiving.service';
import { ItemAgeDosageController } from './item-age-dosage.controller';
import { ItemAgeDosageService } from './item-age-dosage.service';

// Inventory & Procurement, Phase 1d (docs/DEVELOPMENT_ROADMAP.md). Owns
// Item/Stock (docs/PRODUCT_REQUIREMENTS.md §9 data-ownership table) — Item
// and Stock services are exported for Clinical Operations to read from once
// it's built; no other module writes to Inventory's tables directly
// (docs/CODING_STANDARDS.md §3).
@Module({
  imports: [CoreModule],
  controllers: [
    NewItemRequestController,
    ItemController,
    ItemCategoryController,
    SupplierController,
    StockController,
    ProcurementRequestController,
    PurchaseOrderController,
    ItemAgeDosageController,
  ],
  providers: [
    NewItemRequestService,
    ItemService,
    ItemCategoryService,
    ItemPanelPricingService,
    InventoryImportService,
    SupplierService,
    StockService,
    ProcurementRequestService,
    PurchaseOrderService,
    GoodsReceivingService,
    ItemAgeDosageService,
  ],
  exports: [ItemService, StockService],
})
export class InventoryModule {}
