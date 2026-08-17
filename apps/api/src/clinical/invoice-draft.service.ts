import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { assertMayTouchVisit, requireActor, withReadOnlyTenantTx } from './clinical-actor';
import { InvoiceDraft, buildInvoiceDraft } from './invoice-draft';
import { InvoiceService } from './invoice.service';
import { ApplyInvoiceDiscountDto } from './dto/apply-invoice-discount.dto';

/**
 * b4 PIECE B — the draft read, and the ONE discount write the bar offers.
 *
 * The READ is the same gate and the same database-enforced read-only
 * transaction as the billing worklist it is built on: any active staff member
 * with branch access may ask what the visit costs.
 *
 * The WRITE is not a write of its own. `discount` finds the visit's open
 * invoice and hands off to `InvoiceService.applyInvoiceDiscount` — the same
 * method the Billing Review screen calls, so the permission
 * (`billing.corrections`, D-093 owner decision 5), the mandatory reason, the
 * actor, the timestamp, the ceiling check and the recalculation are all the
 * existing ones. There is no canvas-specific discount path, no
 * canvas-specific permission and no second place a discount is stored.
 *
 * WHEN THERE IS NO INVOICE YET the discount is REFUSED, in words. A discount
 * reduces a bill, and until billing raises one there is nothing to reduce.
 * The alternative — raising the visit's invoice from the consultation canvas
 * — was rejected deliberately: an invoice with lines pulled early flips the
 * worklist's items to `billed`, and `pendingBillingWork` reads exactly that
 * to decide where the doctor's completion sends the patient. A bottom bar
 * must not be able to reroute a patient away from the payment counter as a
 * side effect of recording a discount.
 */
@Injectable()
export class InvoiceDraftService {
  constructor(
    private readonly rawPrisma: PrismaService,
    private readonly invoices: InvoiceService,
  ) {}

  async forVisit(visitId: string): Promise<InvoiceDraft> {
    return withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      await assertMayTouchVisit(tx, visitId, actor);
      const visit = await tx.visit.findUnique({ where: { id: visitId }, select: { id: true } });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }
      return buildInvoiceDraft(tx, visitId);
    });
  }

  /**
   * The invoice-level discount, applied through the invoice's own service.
   * The reason is mandatory in the DTO and is recorded with the actor and the
   * timestamp by `applyInvoiceDiscount`; nothing is recorded here.
   */
  async applyDiscount(visitId: string, dto: ApplyInvoiceDiscountDto): Promise<InvoiceDraft> {
    const invoice = await withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      await assertMayTouchVisit(tx, visitId, actor);
      return tx.invoice.findFirst({
        where: { visitId, status: InvoiceStatus.UNPAID },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
    });
    if (!invoice) {
      throw new BadRequestException(
        'There is no open invoice for this visit yet, so there is nothing to discount. ' +
          'The discount can be applied once the counter raises the bill.',
      );
    }
    await this.invoices.applyInvoiceDiscount(invoice.id, dto);
    return this.forVisit(visitId);
  }
}
