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
