import { InvoiceLinePriceRule } from '@prisma/client';
import { ClinicalTx } from './clinical-actor';

/**
 * G4.5d3c-3b1 (D-093) — the ONE place a contractual unit price comes from.
 *
 * The owner's precedence, exactly and only:
 *
 *   1. a specific PanelPriceOverride for the exact item/service
 *   2. otherwise the clinic cash price + the panel-wide FIXED MARKUP (RM)
 *   3. otherwise the clinic cash price
 *
 * A specific panel price REPLACES the markup-derived price — the two are
 * never stacked. A NULL or zero markup means the cash price stands. Free-text
 * manual lines never pass through here: they are priced by the biller and
 * stamped MANUAL.
 *
 * Every resolution returns its own provenance (rule, base price, markup
 * applied), which the line persists for audit/management surfaces — and which
 * the standard patient/panel invoice must never render.
 */
export interface ResolvedPrice {
  unitPrice: number;
  priceRule: InvoiceLinePriceRule;
  baseUnitPrice: number;
  panelMarkupAmount: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveContractualPrice(params: {
  cashPrice: number;
  specificPanelPrice: number | null;
  panelMarkupAmount: number | null;
}): ResolvedPrice {
  const { cashPrice, specificPanelPrice, panelMarkupAmount } = params;
  if (specificPanelPrice != null) {
    return {
      unitPrice: round2(specificPanelPrice),
      priceRule: InvoiceLinePriceRule.SPECIFIC_PANEL_PRICE,
      baseUnitPrice: round2(cashPrice),
      panelMarkupAmount: null,
    };
  }
  if (panelMarkupAmount != null && panelMarkupAmount > 0) {
    return {
      unitPrice: round2(cashPrice + panelMarkupAmount),
      priceRule: InvoiceLinePriceRule.CASH_PLUS_MARKUP,
      baseUnitPrice: round2(cashPrice),
      panelMarkupAmount: round2(panelMarkupAmount),
    };
  }
  return {
    unitPrice: round2(cashPrice),
    priceRule: InvoiceLinePriceRule.CASH,
    baseUnitPrice: round2(cashPrice),
    panelMarkupAmount: null,
  };
}

/**
 * Load-and-resolve for a SOURCED line, inside the caller's transaction.
 * Returns null when the source id does not resolve to a priceable row —
 * the caller refuses rather than falling back to a client-supplied figure.
 */
export async function resolveSourcedPrice(
  tx: ClinicalTx,
  params: {
    panelClinicId: string | null;
    sourcePrescriptionId?: string;
    sourceOrderServiceId?: string;
  },
): Promise<ResolvedPrice | null> {
  const { panelClinicId } = params;
  const panel = panelClinicId
    ? await tx.panelClinic.findUnique({
        where: { id: panelClinicId },
        select: { inventoryMarkupAmount: true, serviceMarkupAmount: true },
      })
    : null;

  if (params.sourcePrescriptionId) {
    const prescription = await tx.prescription.findUnique({
      where: { id: params.sourcePrescriptionId },
      select: { itemId: true, item: { select: { sellPrice: true } } },
    });
    if (!prescription?.item) return null;
    const override = panelClinicId
      ? await tx.panelPriceOverride.findFirst({
          where: { panelClinicId, itemId: prescription.itemId },
          select: { overridePrice: true },
        })
      : null;
    return resolveContractualPrice({
      cashPrice: Number(prescription.item.sellPrice),
      specificPanelPrice: override ? Number(override.overridePrice) : null,
      panelMarkupAmount: panel?.inventoryMarkupAmount != null ? Number(panel.inventoryMarkupAmount) : null,
    });
  }

  if (params.sourceOrderServiceId) {
    const order = await tx.orderService.findUnique({
      where: { id: params.sourceOrderServiceId },
      select: { serviceCatalogId: true, serviceCatalog: { select: { price: true } } },
    });
    if (!order?.serviceCatalog) return null;
    const override = panelClinicId
      ? await tx.panelPriceOverride.findFirst({
          where: { panelClinicId, serviceCatalogId: order.serviceCatalogId },
          select: { overridePrice: true },
        })
      : null;
    return resolveContractualPrice({
      cashPrice: Number(order.serviceCatalog.price),
      specificPanelPrice: override ? Number(override.overridePrice) : null,
      panelMarkupAmount: panel?.serviceMarkupAmount != null ? Number(panel.serviceMarkupAmount) : null,
    });
  }

  return null;
}
