import { DispenseCalculation, dispenseCalculation } from './dispense-pricing';
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
  /**
   * PRESCRIPTIONS ONLY — the conversion from what the doctor wrote to what
   * comes off the shelf and onto the bill.
   *
   * `unitPrice` on a medicine is the price of one STOCK UNIT (a strip, a pack),
   * which the clinic's own import settles beyond doubt: RM155.00 against
   * "10 BIJI / STRIP" is a course of Tamiflu, not one capsule. The
   * prescription's quantity is counted in DOSE UNITS. Multiplying them
   * together — which is what every caller did before this field existed —
   * bills that course at RM1,550.
   *
   * Absent on services and orders, whose quantity and price are already in the
   * same unit.
   */
  dispense?: DispenseCalculation;
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
    /**
     * G4.5d3c-3b2 (D-094) — a consultation charge's source is a ServiceCatalog
     * record selected by the tariff rule; there is no order row. Same
     * precedence and same service-markup column as an order-sourced service —
     * one pricing truth, not a consultation-specific fork.
     */
    serviceCatalogId?: string;
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
      select: {
        itemId: true,
        quantity: true,
        item: {
          select: {
            sellPrice: true,
            quantityPerStockUnit: true,
            unitsPerPack: true,
            dispensedWholeAt: true,
          },
        },
      },
    });
    if (!prescription?.item) return null;
    const override = panelClinicId
      ? await tx.panelPriceOverride.findFirst({
          where: { panelClinicId, itemId: prescription.itemId },
          select: { overridePrice: true },
        })
      : null;
    return {
      ...resolveContractualPrice({
        cashPrice: Number(prescription.item.sellPrice),
        specificPanelPrice: override ? Number(override.overridePrice) : null,
        panelMarkupAmount: panel?.inventoryMarkupAmount != null ? Number(panel.inventoryMarkupAmount) : null,
      }),
      // Attached here rather than left to each caller, because there are three
      // of them and the one thing worse than the wrong number is two surfaces
      // reaching different wrong numbers.
      dispense: dispenseCalculation(prescription.quantity, prescription.item),
    };
  }

  if (params.serviceCatalogId) {
    const service = await tx.serviceCatalog.findUnique({
      where: { id: params.serviceCatalogId },
      select: { price: true },
    });
    if (!service) return null;
    const override = panelClinicId
      ? await tx.panelPriceOverride.findFirst({
          where: { panelClinicId, serviceCatalogId: params.serviceCatalogId },
          select: { overridePrice: true },
        })
      : null;
    return resolveContractualPrice({
      cashPrice: Number(service.price),
      specificPanelPrice: override ? Number(override.overridePrice) : null,
      panelMarkupAmount: panel?.serviceMarkupAmount != null ? Number(panel.serviceMarkupAmount) : null,
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
