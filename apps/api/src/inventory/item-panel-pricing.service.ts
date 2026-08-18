import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { resolveContractualPrice } from '../clinical/billing-pricing';

/**
 * PANEL PRICING, SEEN FROM THE ITEM.
 *
 * The store already exists — `PanelPriceOverride`, keyed by panel, edited from
 * the Panel detail screen. This is the same table read the other way round,
 * because the question the Edit Inventory screen asks is "what does each panel
 * pay for THIS medicine", and answering it from a panel-keyed screen means
 * opening every panel in turn.
 *
 * NO SECOND STORE, and no second arithmetic: the effective price comes from
 * `resolveContractualPrice`, the same function `resolveSourcedPrice` calls when
 * an invoice line is priced (D-093). That is the whole point of returning an
 * effective price at all — a screen that showed the override and left the
 * clinic to work out what the patient is actually charged would be the
 * silently-divergent money field this package is supposed to prevent.
 *
 * ON D2, AND THE OWNER SHOULD KNOW: item panel overrides are NOT stored ahead
 * of billing logic. `resolveSourcedPrice` reads this table today for any
 * prescription line on a panel visit, so a price recorded here changes what a
 * panel patient is billed on the next invoice raised. The screen therefore
 * says THAT, rather than "recorded — not yet used in billing", which would be
 * a false reassurance about money. Already-billed lines are read, not
 * re-priced (Piece B), so nothing already charged moves.
 */
@Injectable()
export class ItemPanelPricingService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async listForItem(itemId: string) {
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { sellPrice: true } });
    if (!item) throw new NotFoundException('Item not found');

    const [panels, overrides] = await Promise.all([
      this.prisma.panelClinic.findMany({
        where: { active: true },
        select: { id: true, name: true, code: true, inventoryMarkupAmount: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.panelPriceOverride.findMany({
        where: { itemId },
        select: { id: true, panelClinicId: true, overridePrice: true },
      }),
    ]);

    const byPanel = new Map(overrides.map((o) => [o.panelClinicId, o]));
    const cashPrice = Number(item.sellPrice);

    return panels.map((panel) => {
      const override = byPanel.get(panel.id);
      const markup = panel.inventoryMarkupAmount == null ? null : Number(panel.inventoryMarkupAmount);
      const resolved = resolveContractualPrice({
        cashPrice,
        specificPanelPrice: override ? Number(override.overridePrice) : null,
        panelMarkupAmount: markup,
      });
      return {
        panelClinicId: panel.id,
        panelName: panel.name,
        panelCode: panel.code,
        overrideId: override?.id ?? null,
        overridePrice: override ? String(override.overridePrice) : null,
        /** The panel's blanket markup, which applies where there is no override. */
        markupAmount: markup == null ? null : markup.toFixed(2),
        /** What a patient on this panel is charged. */
        effectivePrice: resolved.unitPrice.toFixed(2),
        /** Which of the three rules produced it — the invoice line's own word. */
        priceRule: resolved.priceRule,
      };
    });
  }

  /**
   * Set or clear one panel's price for one item.
   *
   * `null` DELETES the override rather than storing zero. A zero override is a
   * real and different statement — this panel pays nothing for this medicine —
   * and a screen that cleared a field into a free medicine would be the worst
   * kind of silent divergence.
   */
  async setForItem(itemId: string, panelClinicId: string, overridePrice: number | null) {
    const [item, panel] = await Promise.all([
      this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true } }),
      this.prisma.panelClinic.findUnique({ where: { id: panelClinicId }, select: { id: true } }),
    ]);
    if (!item) throw new NotFoundException('Item not found');
    // Not redundant with the FK: PostgreSQL checks foreign keys through
    // internal triggers that RLS does not apply to, so another clinic's panel
    // id would be accepted and then read back as nothing.
    if (!panel) throw new NotFoundException('Panel not found');
    if (overridePrice != null && (!Number.isFinite(overridePrice) || overridePrice < 0)) {
      throw new BadRequestException('A panel price cannot be negative.');
    }

    const existing = await this.prisma.panelPriceOverride.findFirst({
      where: { itemId, panelClinicId },
      select: { id: true },
    });

    if (overridePrice == null) {
      if (existing) await this.prisma.panelPriceOverride.delete({ where: { id: existing.id } });
      return { panelClinicId, overridePrice: null };
    }

    if (existing) {
      await this.prisma.panelPriceOverride.update({
        where: { id: existing.id },
        data: { overridePrice },
      });
    } else {
      await this.prisma.panelPriceOverride.create({
        data: { tenantId: currentTenantId(), panelClinicId, itemId, overridePrice },
      });
    }
    return { panelClinicId, overridePrice: overridePrice.toFixed(2) };
  }
}
