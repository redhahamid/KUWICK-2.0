-- CreateEnum
CREATE TYPE "InvoiceLinePriceRule" AS ENUM ('SPECIFIC_PANEL_PRICE', 'CASH_PLUS_MARKUP', 'CASH', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "base_unit_price" DECIMAL(10,2),
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_staff_id" TEXT,
ADD COLUMN     "line_discount_amount" DECIMAL(10,2),
ADD COLUMN     "line_discount_at" TIMESTAMP(3),
ADD COLUMN     "line_discount_by_staff_id" TEXT,
ADD COLUMN     "line_discount_reason" TEXT,
ADD COLUMN     "line_discount_type" "InvoiceDiscountType",
ADD COLUMN     "line_discount_value" DECIMAL(10,2),
ADD COLUMN     "panel_markup_amount" DECIMAL(10,2),
ADD COLUMN     "price_rule" "InvoiceLinePriceRule",
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "invoice_discount_amount" DECIMAL(10,2),
ADD COLUMN     "invoice_discount_at" TIMESTAMP(3),
ADD COLUMN     "invoice_discount_by_staff_id" TEXT,
ADD COLUMN     "invoice_discount_reason" TEXT,
ADD COLUMN     "invoice_discount_type" "InvoiceDiscountType",
ADD COLUMN     "invoice_discount_value" DECIMAL(10,2),
ADD COLUMN     "panel_responsibility_amount" DECIMAL(10,2),
ADD COLUMN     "subtotal_amount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "panel_clinics" ADD COLUMN     "inventory_markup_amount" DECIMAL(10,2),
ADD COLUMN     "service_markup_amount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "dispensed_by_staff_id" TEXT;
