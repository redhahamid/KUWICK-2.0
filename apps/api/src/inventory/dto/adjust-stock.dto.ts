import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, NotEquals } from 'class-validator';

/**
 * The quick +/− on the inventory list.
 *
 * NOT a goods receipt. `quickAdd` creates a StockBatch and a GOODS_RECEIVED
 * movement, which asserts that stock arrived from somewhere — with no
 * supplier, no batch number and no expiry, that is a receipt nobody can
 * reconcile. A person tapping + on a list because the shelf says 41 and the
 * screen says 40 is CORRECTING the record, and ADJUSTMENT is the ledger entry
 * that says so.
 *
 * The reason is REQUIRED, which the stock-take flow already establishes: an
 * adjustment without one is an unexplained change to a number the clinic
 * counts money against.
 */
export class AdjustStockDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  itemId!: string;

  /** Signed. Negative takes stock off the shelf; zero is not a correction. */
  @IsInt()
  @NotEquals(0)
  quantityDelta!: number;

  @IsString()
  @IsNotEmpty({ message: 'An adjustment needs a reason — say why the count changed.' })
  @MaxLength(200)
  reason!: string;
}
