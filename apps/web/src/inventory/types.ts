import { ProcurementRequestStatus, PurchaseOrderStatus } from '@kuwick/shared';

export interface Item {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  category: string | null;
  unitOfMeasure: string | null;
  doseDefault: string | null;
  doseUnitDefault: string | null;
  frequencyDefault: string | null;
  durationDefault: string | null;
  instruction: string | null;
  indication: string | null;
  // "Conc. Vol (mL)" / "Strength (mg)" on the audited Edit Inventory
  // screen — feeds the weight-based dosage calculator (docs/DECISIONS.md
  // D-028). Only liquid/syrup medicines carry these.
  concVolMl: string | null;
  strengthMg: string | null;
  consumptionMethod: string | null;
  defaultDispenseQuantity: number | null;
  prescriptionReference: string | null;
  remark: string | null;
  sellPrice: string;
  cost: string | null;
  active: boolean;

  // ---- KW2-Q3 fields, imported from the clinic's own export --------------
  //
  // b1 — the browser has always received these; the type simply did not admit
  // it, so the medicine search could not show the clinic its own shelf. The
  // Malay grouping in particular is how staff think about medicines, and it
  // was invisible to every surface for want of four lines here.

  /** The clinic's own Malay grouping: BATUK, DEMAM, ANTIBIOTIK… */
  groupTag?: string | null;
  /** Flagged "(CASH ONLY)" in the source. Shown, never silently applied. */
  cashOnly?: boolean;
  /** The name exactly as exported, "##***" and all. */
  sourceName?: string | null;
  /** The raw packaging string: "10 BIJI / STRIP", "PLASTIC/6 SACHET". */
  packDescription?: string | null;
  /** Parsed only where the pack string starts with a count; else null. */
  unitsPerPack?: number | null;
  /** How the prescribing form behaves when this medicine is chosen. */
  dosingType?: ItemDosingType;

  // ---- 1F — the standard prescription this medicine's form opens with ----
  //
  // PHASE 1G. These are the CLINIC'S data, not platform rows: editable on the
  // medicine, and they decide only the STARTING POINT of a prescription.
  // Changing them affects future prescriptions only — a prescription copies
  // its values when it is written, so nothing already dispensed moves.
  defaultDoseAmount?: string | null;
  defaultDoseUnitId?: string | null;
  defaultFrequencyId?: string | null;
  defaultDurationValue?: number | null;
  defaultDurationUnit?: DurationUnit | null;
  defaultQuantity?: number | null;
  defaultConsumptionMethodId?: string | null;
  /**
   * True while these defaults are still exactly as the platform seeded them.
   * Cleared by the API the moment anyone here edits one, which is what stops
   * the next seed run reverting a doctor's correction. Read-only to this app.
   */
  defaultsFromSeed?: boolean;

  /**
   * b1 — stock, travelling WITH the item. The search list has to say what is
   * on the shelf, and annotating twenty options by downloading every stock
   * level is the whole-catalogue mistake one table across.
   */
  stockLevels?: ItemStockLevel[];
}

export type ItemDosingType = 'WEIGHT_BASED' | 'AGE_BAND' | 'ADULT_DEFAULT';

/** 1F — the units a default course length is expressed in. */
export type DurationUnit = 'DAY' | 'WEEK' | 'MONTH';

export interface ItemStockLevel {
  clinicId: string;
  quantityOnHand: number;
  minThreshold: number;
}

export interface CreateItemDto {
  code?: string;
  name: string;
  category?: string;
  unitOfMeasure?: string;
  doseDefault?: string;
  doseUnitDefault?: string;
  frequencyDefault?: string;
  durationDefault?: string;
  instruction?: string;
  indication?: string;
  concVolMl?: number;
  strengthMg?: number;
  consumptionMethod?: string;
  defaultDispenseQuantity?: number;
  prescriptionReference?: string;
  remark?: string;
  sellPrice: number;
  cost?: number;

  // 1F. `null` is a real value here and is not the same as omitting the field:
  // it is how a doctor says "no default for this one", and the API treats the
  // key being present as the clinic taking ownership of the row.
  defaultDoseAmount?: number | null;
  defaultDoseUnitId?: string | null;
  defaultFrequencyId?: string | null;
  defaultDurationValue?: number | null;
  defaultDurationUnit?: DurationUnit | null;
  defaultQuantity?: number | null;
  defaultConsumptionMethodId?: string | null;
}

export type UpdateItemDto = Partial<CreateItemDto> & { active?: boolean };

export interface ItemAgeDosage {
  id: string;
  tenantId: string;
  itemId: string;
  ageFromMonths: number;
  ageToMonths: number;
  amount: string;
  unit: string;
  frequency: string;
}

export interface CreateItemAgeDosageDto {
  itemId: string;
  ageFromMonths: number;
  ageToMonths: number;
  amount: number;
  unit: string;
  frequency: string;
}

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export interface CreateSupplierDto {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
}

export interface StockLevel {
  id: string;
  tenantId: string;
  clinicId: string;
  itemId: string;
  quantityOnHand: number;
  minThreshold: number;
  item: Item;
}

export interface StockBatch {
  id: string;
  clinicId: string;
  itemId: string;
  batchNumber: string | null;
  quantity: number;
  expiryDate: string | null;
  receivedDate: string;
  supplierId: string | null;
  addedByStaffId: string | null;
}

export interface SetStockMinThresholdDto {
  clinicId: string;
  itemId: string;
  minThreshold: number;
}

// Near-expiry surface (D-043) — a StockBatch with stock still on hand,
// enriched with the item/clinic/supplier it belongs to and the number of
// days left before it expires (negative once already expired).
export interface NearExpiryBatch extends StockBatch {
  item: Item;
  clinic: { id: string; name: string };
  supplier: Supplier | null;
  daysToExpiry: number;
}

// Stock take (D-043) — physical count vs system, reconciled via an
// ADJUSTMENT stock movement for any variance.
export interface StockTakeCountDto {
  itemId: string;
  countedQuantity: number;
}

export interface StockTakeDto {
  clinicId: string;
  countedByStaffId?: string;
  counts: StockTakeCountDto[];
}

export interface StockTakeResultRow {
  itemId: string;
  itemName: string;
  systemQuantity: number;
  countedQuantity: number;
  variance: number;
}

export interface StockTakeResult {
  clinicId: string;
  countedItems: number;
  adjustedItems: number;
  results: StockTakeResultRow[];
}

// "Inventory In" quick modal (Task #62) — records incoming stock without a
// formal Purchase Order, e.g. free samples or a walk-in supplier drop-off.
export interface QuickAddStockDto {
  clinicId: string;
  itemId: string;
  quantity: number;
  supplierId?: string;
  expiryDate?: string;
  batchNumber?: string;
  addedByStaffId?: string;
}

export interface ProcurementRequest {
  id: string;
  tenantId: string;
  clinicId: string;
  itemId: string;
  requestedQuantity: number;
  status: ProcurementRequestStatus;
  item: Item;
}

export interface CreateProcurementRequestDto {
  clinicId: string;
  itemId: string;
  requestedQuantity: number;
}

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  itemId: string;
  procurementRequestId: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: string;
  item: Item;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  clinicId: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  orderedAt: string;
  supplier: Supplier;
  lines: PurchaseOrderLine[];
}

export interface CreatePurchaseOrderLineDto {
  itemId: string;
  procurementRequestId?: string;
  orderedQuantity: number;
  unitCost: number;
}

export interface CreatePurchaseOrderDto {
  clinicId: string;
  supplierId: string;
  lines: CreatePurchaseOrderLineDto[];
}

export interface ReceivePurchaseOrderLineDto {
  purchaseOrderLineId: string;
  quantityReceived: number;
  batchNumber?: string;
  expiryDate?: string;
  unitCost?: number;
}

export interface ReceivePurchaseOrderDto {
  clinicId: string;
  lines: ReceivePurchaseOrderLineDto[];
}

export interface GoodsReceivedNoteLine {
  id: string;
  purchaseOrderLineId: string;
  itemId: string;
  quantityReceived: number;
  batchNumber: string | null;
  expiryDate: string | null;
  unitCost: string | null;
}

export interface GoodsReceivedNote {
  id: string;
  clinicId: string;
  purchaseOrderId: string;
  receivedAt: string;
  lines: GoodsReceivedNoteLine[];
}
