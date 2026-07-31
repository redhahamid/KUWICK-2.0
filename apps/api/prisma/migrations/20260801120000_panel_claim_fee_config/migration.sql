-- D-041 (owner refinement, 2026-08-01): claim fees are configured per
-- panel — a % of the claimed amount or a flat RM value per claim — and
-- applied automatically at batch creation. Most panels (e.g. AIA) have
-- none. Replaces the manual per-batch fee % entry.

-- CreateEnum
CREATE TYPE "PanelClaimFeeType" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "panel_clinics" ADD COLUMN "claim_fee_type" "PanelClaimFeeType";
ALTER TABLE "panel_clinics" ADD COLUMN "claim_fee_value" DECIMAL(10,2);
