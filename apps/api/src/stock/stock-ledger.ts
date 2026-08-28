import { Prisma, StockAdjustmentReason, StockMovementType } from '@prisma/client';

/**
 * THE ONE WRITE PATH INTO STOCK.
 *
 * Owner brief §3: "CURRENT STOCK = derived from auditable stock movements,
 * with controlled stock-take adjustments." That is only true if there is
 * exactly one function that may change a stock level, and it always writes the
 * movement in the same transaction. Two write paths is how a balance and its
 * ledger stop agreeing — and once they disagree there is no way to tell which
 * one is lying.
 *
 * This module is that function. `StockService`, `InventoryReceivingService`,
 * `DispensaryService`, transfers and stock takes all go through it.
 *
 * NEGATIVE STOCK IS ALLOWED, deliberately (D-020, product-owner decision):
 * front-line staff dispense immediately even when system stock has not caught
 * up with physically-received goods, and admin reconciles negative rows
 * afterwards rather than being blocked at the counter. The DB CHECK enforcing
 * >= 0 was tried and removed. This function does not reintroduce it.
 */

export type LedgerTx = Prisma.TransactionClient;

export interface MovementInput {
  tenantId: string;
  clinicId: string;
  itemId: string;
  /**
   * STOCK UNITS — strips, boxes, bottles. Signed: negative removes.
   * Never dose units; see `StockMovement.quantityDelta`.
   */
  quantityDelta: number;
  movementType: StockMovementType;
  /** The structured reason, for every movement that is not routine trade. */
  adjustmentReason?: StockAdjustmentReason | null;
  batchId?: string | null;
  /** The dose-unit quantity behind a dispense, when there is one. */
  clinicalQuantity?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdByStaffId?: string | null;
  createdByUserId?: string | null;
  notes?: string | null;
}

export interface MovementResult {
  movementId: string;
  quantityBefore: number;
  quantityAfter: number;
}

/** Appends a movement and updates the derived level, in one transaction. */
export async function postMovement(tx: LedgerTx, input: MovementInput): Promise<MovementResult> {
  const movement = await tx.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      itemId: input.itemId,
      batchId: input.batchId ?? null,
      movementType: input.movementType,
      adjustmentReason: input.adjustmentReason ?? null,
      quantityDelta: input.quantityDelta,
      clinicalQuantity: input.clinicalQuantity ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      createdByStaffId: input.createdByStaffId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  // THE LEVEL IS INCREMENTED, NEVER SET.
  //
  // `increment` is a single atomic UPDATE at the database, so two concurrent
  // dispenses of the same item cannot both read 10 and both write 9. A
  // read-then-write — which is what a "set the new total" implementation
  // looks like — loses one of them silently, and the ledger then disagrees
  // with the level it is supposed to justify.
  //
  // `quantityBefore` is DERIVED from the post-state rather than read
  // beforehand, for the same reason: a value read outside the update is a
  // value another transaction may already have changed. after − delta is
  // exactly what this movement applied to, under any interleaving.
  const level = await upsertLevel(tx, input);

  return {
    movementId: movement.id,
    quantityBefore: level.quantityOnHand - input.quantityDelta,
    quantityAfter: level.quantityOnHand,
  };
}

/**
 * Upsert-with-increment, with one retry.
 *
 * Two concurrent movements for an item that has never been stocked at this
 * branch both take the `create` branch and one loses on the unique constraint.
 * The loser retries, finds the row the winner created, and increments. One
 * retry is enough because after it the row certainly exists.
 */
async function upsertLevel(tx: LedgerTx, input: MovementInput): Promise<{ quantityOnHand: number }> {
  const where = {
    tenantId_clinicId_itemId: {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      itemId: input.itemId,
    },
  };
  const create = {
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    itemId: input.itemId,
    quantityOnHand: input.quantityDelta,
  };
  const update = { quantityOnHand: { increment: input.quantityDelta } };

  try {
    return await tx.stockLevel.upsert({ where, create, update, select: { quantityOnHand: true } });
  } catch {
    return tx.stockLevel.update({ where, data: update, select: { quantityOnHand: true } });
  }
}

/**
 * The balance a ledger implies, recomputed from movements.
 *
 * Used by the reconciliation check, not by ordinary reads — `StockLevel` is
 * the cache and reading it is the fast path. This exists so that "is the cache
 * still right" is a question with an answer, and so that a test can assert it.
 */
export async function recomputeBalance(
  tx: LedgerTx,
  where: { tenantId: string; clinicId: string; itemId: string },
): Promise<number> {
  const result = await tx.stockMovement.aggregate({
    where,
    _sum: { quantityDelta: true },
  });
  return result._sum.quantityDelta ?? 0;
}

/**
 * The movement type a structured reason implies.
 *
 * A single mapping so that "expired" always produces an EXPIRY movement and
 * never an ADJUSTMENT with the word "expired" in a note — the difference
 * between a report that can answer "how much did we lose to expiry" and one
 * that cannot.
 */
export function movementTypeForReason(reason: StockAdjustmentReason): StockMovementType {
  switch (reason) {
    case 'EXPIRED':
      return StockMovementType.EXPIRY;
    case 'DAMAGED':
    case 'WASTAGE':
      return StockMovementType.WASTAGE;
    case 'INTERNAL_USE':
      return StockMovementType.INTERNAL_USE;
    case 'RETURN_TO_SUPPLIER':
      return StockMovementType.RETURN_TO_SUPPLIER;
    case 'RETURN_FROM_PATIENT':
      return StockMovementType.RETURN_FROM_PATIENT;
    case 'OPENING_BALANCE':
      return StockMovementType.OPENING_BALANCE;
    case 'COUNT_CORRECTION':
      return StockMovementType.STOCK_TAKE;
    // DATA_ENTRY_ERROR and OTHER stay a plain ADJUSTMENT: they describe a
    // correction to the RECORD rather than a physical event, and inventing a
    // movement type for them would put a category on a report that means
    // "somebody typed the wrong thing".
    case 'DATA_ENTRY_ERROR':
    case 'OTHER':
    default:
      return StockMovementType.ADJUSTMENT;
  }
}

/** Movement types that REMOVE stock, for reports that need the distinction. */
export const OUTBOUND_TYPES: StockMovementType[] = [
  StockMovementType.DISPENSED,
  StockMovementType.TRANSFER_OUT,
  StockMovementType.INTERNAL_USE,
  StockMovementType.WASTAGE,
  StockMovementType.EXPIRY,
  StockMovementType.RETURN_TO_SUPPLIER,
];

/** Movement types that ADD stock. */
export const INBOUND_TYPES: StockMovementType[] = [
  StockMovementType.GOODS_RECEIVED,
  StockMovementType.TRANSFER_IN,
  StockMovementType.RETURN_FROM_PATIENT,
  StockMovementType.OPENING_BALANCE,
];
