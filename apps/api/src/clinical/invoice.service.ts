import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceDiscountType, InvoiceLinePriceRule, InvoiceStatus, PanelVerificationStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { ClinicalTx, assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { BillingAction, assertCanPerformBilling } from './clinical-authorization';
import { BenefitInput, calculateResponsibility } from './billing-calculation';
import { resolveSourcedPrice } from './billing-pricing';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { AddInvoiceLineDto } from './dto/add-invoice-line.dto';
import { ApplyLineDiscountDto } from './dto/apply-line-discount.dto';
import { ApplyInvoiceDiscountDto } from './dto/apply-invoice-discount.dto';
import { CancelInvoiceLineDto } from './dto/cancel-invoice-line.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { PayInvoiceDto } from './dto/pay-invoice.dto';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The approved counter-facing wording — the same sentence the blocker uses. */
const RESPONSIBILITY_UNRESOLVED = 'Billing responsibility has not been confirmed.';

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly visits: VisitService,
  ) {}

  // Count-based sequence ("INV-000002"), same accepted non-atomic-race gap
  // as Visit.visitNumber.
  private async nextInvoiceNumber(tx: ClinicalTx): Promise<string> {
    const count = await tx.invoice.count();
    return `INV-${String(count + 1).padStart(6, '0')}`;
  }

  /**
   * G3c closure (D-066) — the ONE billing gate. Every invoice mutation goes
   * through it; none of them does its own role check. The actor is resolved
   * from the session, the role checked against the action, and branch access
   * checked against the visit resolved FROM STORED DATA.
   */
  private async authoriseBilling(action: BillingAction, visitId: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformBilling(actor, action);
      await assertMayTouchVisit(tx, visitId, actor);
      return actor;
    });
  }

  /** Resolves an invoice's OWN visit — the only visit id a mutation trusts. */
  private async invoiceVisitId(invoiceId: string): Promise<string> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { visitId: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice.visitId;
  }

  // ==========================================================================
  // G4.5d3c-3b1 (D-093) — THE RESPONSIBILITY WRITER.
  //
  // The 3b0 audit's headline finding: patientResponsibilityAmount had no
  // production writer — both completion services read it as the authority and
  // nothing ever set it. This is that writer. It runs inside EVERY mutating
  // transaction (create, line add/cancel, discounts, benefit changes) so the
  // persisted split can never lag the lines.
  //
  // The benefit terms come from the VISIT SNAPSHOT (D-092) and only from it —
  // the panel's live configuration is never consulted, so a panel whose limit
  // changes tomorrow cannot reprice today's visit.
  // ==========================================================================
  async recalculateInvoice(tx: ClinicalTx, invoiceId: string) {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        visitId: true,
        status: true,
        invoiceDiscountType: true,
        invoiceDiscountValue: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    // PAID and CANCELLED invoices are frozen history; every mutation route
    // already refuses them, and the recalculator refuses to touch them too.
    if (invoice.status !== InvoiceStatus.UNPAID) {
      return undefined;
    }

    const lines = await tx.invoiceLine.findMany({
      where: { invoiceId },
      select: {
        id: true,
        amount: true,
        excludedFromPanel: true,
        cancelledAt: true,
        lineDiscountType: true,
        lineDiscountValue: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const benefit = await this.benefitFor(tx, invoice.visitId);
    const result = calculateResponsibility({
      lines: lines.map((line) => ({
        id: line.id,
        amount: Number(line.amount),
        excludedFromPanel: line.excludedFromPanel,
        cancelled: line.cancelledAt !== null,
        lineDiscountType: line.lineDiscountType,
        lineDiscountValue: line.lineDiscountValue == null ? null : Number(line.lineDiscountValue),
      })),
      invoiceDiscountType: invoice.invoiceDiscountType,
      invoiceDiscountValue: invoice.invoiceDiscountValue == null ? null : Number(invoice.invoiceDiscountValue),
      benefit,
    });

    for (const line of result.lines) {
      await tx.invoiceLine.update({
        where: { id: line.id },
        data: {
          lineDiscountAmount: line.lineDiscountAmount,
          panelResponsibilityAmount: line.panelResponsibilityAmount,
          patientResponsibilityAmount: line.patientResponsibilityAmount,
        },
      });
    }

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotalAmount: result.subtotalAmount,
        totalAmount: result.totalAmount,
        invoiceDiscountAmount: result.invoiceDiscountAmount,
        panelResponsibilityAmount: result.panelResponsibilityAmount,
        patientResponsibilityAmount: result.patientResponsibilityAmount,
      },
    });
  }

  /**
   * The engine's benefit input, from the visit snapshot ONLY. Resolved means
   * an explicit VERIFIED or OVERRIDDEN status with a coverage type captured;
   * anything else on a panel visit is honestly unresolved.
   */
  private async benefitFor(tx: ClinicalTx, visitId: string): Promise<BenefitInput> {
    const visit = await tx.visit.findUnique({
      where: { id: visitId },
      select: {
        panelClinicId: true,
        panelVerificationStatus: true,
        panelCoverageType: true,
        panelVisitLimitAmount: true,
        panelCopaymentType: true,
        panelCopaymentValue: true,
      },
    });
    if (!visit?.panelClinicId) {
      return { kind: 'CASH' };
    }
    const resolvedStatus =
      visit.panelVerificationStatus === PanelVerificationStatus.VERIFIED ||
      visit.panelVerificationStatus === PanelVerificationStatus.OVERRIDDEN;
    if (!resolvedStatus || !visit.panelCoverageType) {
      return { kind: 'PANEL_UNRESOLVED' };
    }
    return {
      kind: 'PANEL_RESOLVED',
      coverageType: visit.panelCoverageType,
      visitLimitAmount: visit.panelVisitLimitAmount == null ? null : Number(visit.panelVisitLimitAmount),
      copaymentType: visit.panelCopaymentType ?? 'NONE',
      copaymentValue: visit.panelCopaymentValue == null ? null : Number(visit.panelCopaymentValue),
    };
  }

  /**
   * D-092/D-093 — a benefit verification or override changes what this
   * visit's UNPAID invoices mean. Called by PanelBenefitService after every
   * terms change.
   */
  async recalculateVisitInvoices(visitId: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: { visitId, status: InvoiceStatus.UNPAID },
        select: { id: true },
      });
      for (const invoice of invoices) {
        await this.recalculateInvoice(tx, invoice.id);
      }
      return invoices.length;
    });
  }

  // createdByStaffId is caller-supplied, not defaulted from the visit —
  // invoice creation is deliberately staff-creatable so a locum covering the
  // queue can bill a visit that isn't "theirs".
  async create(dto: CreateInvoiceDto) {
    await this.authoriseBilling('CREATE_INVOICE', dto.visitId);
    const visit = await this.visits.findById(dto.visitId);
    return withTenantTx(this.rawPrisma, async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId: currentTenantId(),
          visitId: visit.id,
          createdByStaffId: dto.createdByStaffId,
          invoiceNumber: await this.nextInvoiceNumber(tx),
        },
      });
      // An empty cash invoice resolves to 0/0 immediately; an empty panel
      // invoice resolves or stays NULL according to the snapshot. Either way
      // the answer is WRITTEN at creation, not deferred to a later guess.
      return (await this.recalculateInvoice(tx, invoice.id)) ?? invoice;
    });
  }

  /**
   * G3c (D-065) — the read the Clinical Workspace's Invoice Summary uses.
   * Branch access enforced; resolves creator, panel, line sources and claim
   * lines in one trip.
   */
  async findByVisitId(visitId: string) {
    await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      await assertMayTouchVisit(tx, visitId, actor);
    });

    return this.prisma.invoice.findMany({
      where: { visitId },
      include: {
        lines: {
          orderBy: { createdAt: 'asc' },
          include: {
            sourceOrderService: { select: { id: true, procedureName: true, orderType: true, status: true } },
            sourcePrescription: { select: { id: true, itemId: true, status: true, item: { select: { name: true } } } },
          },
        },
        createdBy: { select: { id: true, fullName: true, role: true } },
        claimBatchLines: {
          select: { id: true, status: true, claimedAmount: true, paidAmount: true },
          orderBy: { createdAt: 'desc' },
        },
        visit: {
          select: {
            id: true,
            billingType: true,
            panelClinicId: true,
            panelClinic: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  /**
   * D-093 — a sourced line's price is the SERVER'S. The client's unitPrice is
   * accepted only for a free-text MANUAL line; for a prescription- or
   * order-sourced line the contractual price is resolved here (specific panel
   * price → cash + markup → cash) and anything the browser sent is ignored.
   */
  async addLine(invoiceId: string, dto: AddInvoiceLineDto) {
    await this.authoriseBilling('EDIT_LINES', await this.invoiceVisitId(invoiceId));

    return withTenantTx(this.rawPrisma, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, visitId: true, status: true },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== InvoiceStatus.UNPAID) {
        throw new BadRequestException(`Cannot add a line to an invoice in status ${invoice.status}`);
      }
      const visit = await tx.visit.findUnique({
        where: { id: invoice.visitId },
        select: { panelClinicId: true },
      });
      const panelClinicId = visit?.panelClinicId ?? null;
      const sourced = Boolean(dto.sourceOrderServiceId || dto.sourcePrescriptionId);

      // --- G4.5s (D-073) — one source item, one charge, under lock. --------
      // The source row is locked FOR UPDATE first, so two concurrent adds
      // for the same source serialise; the loser re-reads after the winner
      // commits, sees the line, and is refused with the invoice named.
      if (dto.sourceOrderServiceId) {
        await tx.$executeRaw`SELECT id FROM "order_services" WHERE id = ${dto.sourceOrderServiceId} FOR UPDATE`;
      } else if (dto.sourcePrescriptionId) {
        await tx.$executeRaw`SELECT id FROM "prescriptions" WHERE id = ${dto.sourcePrescriptionId} FOR UPDATE`;
      }
      if (sourced) {
        // Across ALL invoices, and only ACTIVE lines: a cancelled charge is
        // history, not a standing claim on the source.
        const existing = await tx.invoiceLine.findFirst({
          where: {
            ...(dto.sourceOrderServiceId
              ? { sourceOrderServiceId: dto.sourceOrderServiceId }
              : { sourcePrescriptionId: dto.sourcePrescriptionId }),
            cancelledAt: null,
          },
          select: { invoice: { select: { invoiceNumber: true } } },
        });
        if (existing) {
          throw new ConflictException(
            `This item is already charged on invoice ${existing.invoice.invoiceNumber}. It has not been added again.`,
          );
        }
      }

      // --- Pricing (D-093) -------------------------------------------------
      let unitPrice: number;
      let priceRule: InvoiceLinePriceRule;
      let baseUnitPrice: number | null;
      let panelMarkupAmount: number | null;
      if (sourced) {
        const resolved = await resolveSourcedPrice(tx, {
          panelClinicId,
          sourcePrescriptionId: dto.sourcePrescriptionId,
          sourceOrderServiceId: dto.sourceOrderServiceId,
        });
        if (!resolved) {
          throw new BadRequestException('This item cannot be priced — its catalog record was not found.');
        }
        unitPrice = resolved.unitPrice;
        priceRule = resolved.priceRule;
        baseUnitPrice = resolved.baseUnitPrice;
        panelMarkupAmount = resolved.panelMarkupAmount;
      } else {
        if (dto.unitPrice == null) {
          throw new BadRequestException('A manual line needs a unit price.');
        }
        unitPrice = round2(dto.unitPrice);
        priceRule = InvoiceLinePriceRule.MANUAL;
        baseUnitPrice = unitPrice;
        panelMarkupAmount = null;
      }

      // --- Exclusion snapshot ----------------------------------------------
      const exclusion = await this.resolveExclusion(tx, panelClinicId, dto);
      const quantity = dto.quantity ?? 1;

      await tx.invoiceLine.create({
        data: {
          tenantId: currentTenantId(),
          invoiceId,
          description: dto.description,
          quantity,
          unit: dto.unit,
          unitPrice,
          amount: round2(quantity * unitPrice),
          sourceOrderServiceId: dto.sourceOrderServiceId,
          sourcePrescriptionId: dto.sourcePrescriptionId,
          excludedFromPanel: exclusion.excluded,
          panelExclusionReason: exclusion.reason,
          priceRule,
          baseUnitPrice,
          panelMarkupAmount,
        },
      });

      return this.recalculateInvoice(tx, invoiceId);
    });
  }

  // Resolves whether a sourced line is on the visit's panel's exclusion
  // list — computed server-side, with the exclusion's reason snapshotted onto
  // the line so a later list change cannot rewrite this line's history.
  private async resolveExclusion(
    tx: ClinicalTx,
    panelClinicId: string | null,
    dto: AddInvoiceLineDto,
  ): Promise<{ excluded: boolean; reason: string | null }> {
    if (!panelClinicId) return { excluded: false, reason: null };
    let itemId: string | undefined;
    let serviceCatalogId: string | undefined;
    if (dto.sourcePrescriptionId) {
      const prescription = await tx.prescription.findUnique({
        where: { id: dto.sourcePrescriptionId },
        select: { itemId: true },
      });
      itemId = prescription?.itemId;
    } else if (dto.sourceOrderServiceId) {
      const orderService = await tx.orderService.findUnique({
        where: { id: dto.sourceOrderServiceId },
        select: { serviceCatalogId: true },
      });
      serviceCatalogId = orderService?.serviceCatalogId;
    } else {
      // Freehand lines are never auto-excluded; staff can bill an excluded
      // consumable as its own line where needed.
      return { excluded: false, reason: null };
    }
    if (!itemId && !serviceCatalogId) return { excluded: false, reason: null };
    const match = await tx.panelExclusion.findFirst({
      where: {
        panelClinicId,
        ...(itemId ? { itemId } : {}),
        ...(serviceCatalogId ? { serviceCatalogId } : {}),
      },
      select: { reason: true },
    });
    return match
      ? { excluded: true, reason: match.reason ?? 'Not covered by panel' }
      : { excluded: false, reason: null };
  }

  /**
   * D-093 — cancellation, not deletion. A removed charge is a historical
   * fact: the line stays, stamped with who cancelled it, when and why, and
   * leaves every total, worklist and duplicate check. The DELETE route keeps
   * working; its semantics changed from erase to cancel.
   */
  async cancelLine(invoiceId: string, lineId: string, dto: CancelInvoiceLineDto = {}) {
    const actor = await this.authoriseBilling('EDIT_LINES', await this.invoiceVisitId(invoiceId));
    return withTenantTx(this.rawPrisma, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { status: true, lines: { select: { id: true, cancelledAt: true } } },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== InvoiceStatus.UNPAID) {
        throw new BadRequestException(`Cannot remove a line from an invoice in status ${invoice.status}`);
      }
      const line = invoice.lines.find((candidate) => candidate.id === lineId);
      if (!line) {
        throw new NotFoundException('Invoice line not found');
      }
      if (line.cancelledAt) {
        throw new BadRequestException('This line is already cancelled.');
      }
      await tx.invoiceLine.update({
        where: { id: lineId },
        data: {
          cancelledAt: new Date(),
          cancelledByStaffId: actor.id,
          cancelReason: dto.cancelReason?.trim() || null,
          // A cancelled line's split is void, not a number.
          panelResponsibilityAmount: null,
          patientResponsibilityAmount: null,
        },
      });
      return this.recalculateInvoice(tx, invoiceId);
    });
  }

  /**
   * D-093 — line-level discount. Owner/finance only (APPLY_DISCOUNT), with a
   * mandatory reason; refused once the invoice has left UNPAID. `amount`
   * stays the pre-discount figure, so the original is always retained.
   */
  async applyLineDiscount(invoiceId: string, lineId: string, dto: ApplyLineDiscountDto) {
    const actor = await this.authoriseBilling('APPLY_DISCOUNT', await this.invoiceVisitId(invoiceId));
    return withTenantTx(this.rawPrisma, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          status: true,
          lines: { select: { id: true, amount: true, cancelledAt: true } },
        },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== InvoiceStatus.UNPAID) {
        throw new BadRequestException(`Cannot discount an invoice in status ${invoice.status}`);
      }
      const line = invoice.lines.find((candidate) => candidate.id === lineId);
      if (!line) {
        throw new NotFoundException('Invoice line not found');
      }
      if (line.cancelledAt) {
        throw new BadRequestException('A cancelled line cannot be discounted.');
      }
      assertDiscountWithin(dto, Number(line.amount), 'line amount');

      await tx.invoiceLine.update({
        where: { id: lineId },
        data: {
          lineDiscountType: dto.type,
          lineDiscountValue: dto.value,
          lineDiscountReason: dto.reason.trim(),
          lineDiscountByStaffId: actor.id,
          lineDiscountAt: new Date(),
        },
      });
      return this.recalculateInvoice(tx, invoiceId);
    });
  }

  /**
   * D-093 — overall invoice discount, policy AFTER_PANEL_SPLIT_PATIENT_ONLY.
   * Refused while responsibility is unresolved: a patient-portion-only
   * discount has nothing defined to reduce until the split exists.
   */
  async applyInvoiceDiscount(invoiceId: string, dto: ApplyInvoiceDiscountDto) {
    const actor = await this.authoriseBilling('APPLY_DISCOUNT', await this.invoiceVisitId(invoiceId));
    return withTenantTx(this.rawPrisma, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { status: true, visitId: true, subtotalAmount: true },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== InvoiceStatus.UNPAID) {
        throw new BadRequestException(`Cannot discount an invoice in status ${invoice.status}`);
      }
      const benefit = await this.benefitFor(tx, invoice.visitId);
      if (benefit.kind === 'PANEL_UNRESOLVED') {
        throw new BadRequestException(RESPONSIBILITY_UNRESOLVED);
      }
      assertDiscountWithin(dto, Number(invoice.subtotalAmount ?? 0), 'invoice subtotal');

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          invoiceDiscountType: dto.type,
          invoiceDiscountValue: dto.value,
          invoiceDiscountReason: dto.reason.trim(),
          invoiceDiscountByStaffId: actor.id,
          invoiceDiscountAt: new Date(),
        },
      });
      return this.recalculateInvoice(tx, invoiceId);
    });
  }

  async cancel(id: string, dto: CancelInvoiceDto) {
    await this.authoriseBilling('CANCEL_INVOICE', await this.invoiceVisitId(id));
    const invoice = await this.findById(id);
    if (invoice.status !== InvoiceStatus.UNPAID) {
      throw new BadRequestException(`Cannot cancel an invoice in status ${invoice.status}`);
    }
    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED, cancelReason: dto.cancelReason },
    });
  }

  /**
   * D-093 — payment reads the PERSISTED calculation and nothing else.
   *
   * The old implementation recomputed the panel split at pay-time from the
   * panel's LIVE configuration — the exact staleness the visit snapshot
   * exists to prevent — and could "pay" an invoice whose responsibility
   * nobody had ever computed. Now:
   *
   *   - NULL responsibility refuses with the approved counter wording;
   *   - an unresolved panel verification refuses the same way (defence in
   *     depth — its responsibility is NULL anyway);
   *   - 'PANEL' ("Mark Fully Covered by Panel") requires a persisted patient
   *     responsibility of exactly zero;
   *   - the amounts snapshotted at pay-time are the persisted ones. Nothing
   *     is recomputed, so what was shown is what is settled.
   *
   * Invoice.status alone is never proof of anything here.
   */
  async pay(id: string, dto: PayInvoiceDto) {
    await this.authoriseBilling('MARK_PAID', await this.invoiceVisitId(id));
    return withTenantTx(this.rawPrisma, async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id },
        select: {
          id: true,
          visitId: true,
          status: true,
          patientResponsibilityAmount: true,
          panelResponsibilityAmount: true,
        },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.status !== InvoiceStatus.UNPAID) {
        throw new BadRequestException(`Cannot mark an invoice in status ${invoice.status} as paid`);
      }
      if (invoice.patientResponsibilityAmount == null) {
        throw new BadRequestException(RESPONSIBILITY_UNRESOLVED);
      }
      const benefit = await this.benefitFor(tx, invoice.visitId);
      if (benefit.kind === 'PANEL_UNRESOLVED') {
        throw new BadRequestException(RESPONSIBILITY_UNRESOLVED);
      }

      const patientResponsibility = Number(invoice.patientResponsibilityAmount);
      if (dto.paymentMethod === 'PANEL' && patientResponsibility > 0) {
        throw new BadRequestException(
          `Cannot mark as fully covered by panel — a patient copay of ${patientResponsibility} is still due`,
        );
      }

      // All-or-nothing model: the payment recorded is exactly the persisted
      // remaining responsibility, which resolves the balance to zero. Partial
      // tender is a future payment-table design, not smuggled in here.
      const patientPaidAmount = dto.paymentMethod === 'PANEL' ? 0 : patientResponsibility;
      return tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
          paymentMethod: dto.paymentMethod,
          panelCoveredAmount: Number(invoice.panelResponsibilityAmount ?? 0),
          patientPaidAmount,
        },
      });
    });
  }
}

/** Discount guards: positive, percentage ≤ 100, fixed ≤ the eligible amount. */
function assertDiscountWithin(
  dto: { type: InvoiceDiscountType; value: number },
  eligibleAmount: number,
  what: string,
): void {
  if (dto.value <= 0) {
    throw new BadRequestException('A discount must be greater than zero.');
  }
  if (dto.type === InvoiceDiscountType.PERCENTAGE && dto.value > 100) {
    throw new BadRequestException('A percentage discount cannot exceed 100.');
  }
  if (dto.type === InvoiceDiscountType.FIXED_AMOUNT && dto.value > eligibleAmount) {
    throw new BadRequestException(`A fixed discount cannot exceed the ${what}.`);
  }
}
