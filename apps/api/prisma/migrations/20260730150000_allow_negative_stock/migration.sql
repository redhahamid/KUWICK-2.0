-- Reverses part of 20260730130000_add_inventory_module (docs/DECISIONS.md
-- D-020, product-owner decision 2026-07-30): front-line staff must be able
-- to dispense/invoice immediately even when system stock hasn't caught up
-- with physically-received goods, matching real clinic operating practice
-- (the owner's current CMS, Avixo, works the same way). Negative stock is
-- now a monitored/reconciled condition (GET /stock/negative-stock), not a
-- blocked one — see StockService.listNegativeStock.

ALTER TABLE "stock_levels" DROP CONSTRAINT "stock_levels_quantity_on_hand_check";
