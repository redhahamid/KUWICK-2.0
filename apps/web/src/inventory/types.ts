import { ProcurementRequestStatus, PurchaseOrderStatus } from '@kuwick/shared';

export interface Item {
  id: string;
  tenantId: string;
  name: string;
  category: string | null;
  unitOfMeasure: string | null;
  doseDefault: string | null;
  frequencyDefault: string | null;
  durationDefault: string | null;
  instruction: string | null;
  indication: string | null;
  sellPrice: string;
  cost: string | null;
  active: boolean;
}

export interface CreateItemDto {
  name: string;
  category?: string;
  unitOfMeasure?: string;
  doseDefault?: string;
  frequencyDefault?: string;
  durationDefault?: string;
  instruction?: string;
  indication?: string;
  sellPrice: number;
  cost?: number;
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
}

export interface SetStockMinThresholdDto {
  clinicId: string;
  itemId: string;
  minThreshold: number;
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
