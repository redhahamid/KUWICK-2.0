-- Inventory, Task #62. Supports the "Inventory In" quick modal — recording
-- incoming stock without a formal Purchase Order, capturing which
-- supplier it came from and which staff member added it.

-- AlterTable
ALTER TABLE "stock_batches" ADD COLUMN "supplier_id" TEXT;
ALTER TABLE "stock_batches" ADD COLUMN "added_by_staff_id" TEXT;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_added_by_staff_id_fkey" FOREIGN KEY ("added_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
