import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentEventType,
  InvoiceDiscountType,
  InvoiceLinePriceRule,
  InvoiceStatus,
  OrderServiceStatus,
  PanelVerificationStatus,
  PaymentKind,
  PrescriptionStatus,
  PrescriptionSupplyMode,
} from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { ClinicalTx, assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { BillingAction, assertCanPerformBilling } from './clinical-authorization';
import { BenefitInput, calculateResponsibility } from './billing-calculation';
import { resolveSourcedPrice } from './billing-pricing';
import { recordAppointmentEvent } from '../appointment/appointment-event.service';
import { collectBillingWorklist, tariffReviewItems, unbilledReadyItems } from './billing-worklist';
import {
  ConsultationChargeState,
  resolveConsultationState,
  resolveExplicitConsultationAdd,
} from './consultation-tariff';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { AddInvoiceLineDto } from './dto/add-invoice-line.dto';
import { ApplyLineDiscountDto } from './dto/apply-line-discount.dto';
import { ApplyInvoiceDiscountDto } from './dto/apply-invoice-discount.dto';
import { CancelInvoiceLineDto } from './dto/cancel-invoice-line.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { PayInvoiceDto } from './dto/pay-invoice.dto';
import {
  TAX_BASIS_SETTING_KEY,
  applyInvoiceTax,
  taxBasisFrom,
} from '../finance/invoice-tax';
import { TaxCodeSnapshot } from '../finance/tax';
import { PaymentService } from '../finance/payment.service';
import { fromCents, sumCents, toCents } from '../finance/money';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Adds tax to a responsibility amount WITHOUT resolving an unresolved one.
 *
 * NULL means "the split has not been computed" (D-084). It must stay NULL:
 * turning it into 0 by adding zero tax would convert "we do not know what the
 * patient owes" into "the patient owes nothing", and the settlement engine
 * treats those two answers very differently.
 */
function addTax(responsibility: number | null | undefined, taxAmount: number | null | undefined): number | null {
  if (responsibility === null || responsibility === undefined) return null;
  return fromCents(toCents(responsibility) + toCents(taxAmount ?? 0));
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
        createdAt: true,
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
        taxCodeId: true,
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

    // ------------------------------------------------------------------
    // WAVE 1 — SERVICE TAX.
    //
    // Runs AFTER the responsibility split, because the default basis is the
    // patient's portion of each line and that number does not exist until the
    // split has been computed. Inert for a clinic with no tax codes mapped:
    // every line resolves to zero and the invoice's totals are unchanged, byte
    // for byte, from what they were before this block existed.
    // ------------------------------------------------------------------
    const responsibilityById = new Map(result.lines.map((line) => [line.id, line]));
    const tax = await this.applyTax(tx, {
      invoiceCreatedAt: invoice.createdAt,
      lines: lines.map((line) => ({
        id: line.id,
        amount: line.amount,
        lineDiscountAmount: responsibilityById.get(line.id)?.lineDiscountAmount ?? 0,
        patientResponsibilityAmount: responsibilityById.get(line.id)?.patientResponsibilityAmount ?? null,
        taxCodeId: line.taxCodeId,
        cancelledAt: line.cancelledAt,
      })),
    });
    const taxByLine = new Map(tax.lines.map((line) => [line.id, line]));

    for (const line of result.lines) {
      const lineTax = taxByLine.get(line.id);
      await tx.invoiceLine.update({
        where: { id: line.id },
        data: {
          lineDiscountAmount: line.lineDiscountAmount,
          panelResponsibilityAmount: line.panelResponsibilityAmount,
          // The tax a patient is charged is part of what the patient owes. It
          // is added here rather than left as a separate column nobody sums,
          // which keeps `panel + patient = total` true — the invariant the
          // settlement engine and the day-end both depend on.
          //
          // NULL SURVIVES. An unresolved split stays unresolved: adding zero
          // tax to it would turn "we do not know what the patient owes" into
          // "the patient owes nothing", which is the one arithmetic error
          // D-084 exists to prevent.
          patientResponsibilityAmount: addTax(line.patientResponsibilityAmount, lineTax?.taxAmount),
          taxAmount: lineTax?.taxAmount ?? 0,
          taxRatePercent: lineTax?.taxRatePercent ?? null,
          taxTreatment: lineTax?.taxTreatment ?? null,
        },
      });
    }

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotalAmount: result.subtotalAmount,
        totalAmount: fromCents(toCents(result.totalAmount) + tax.taxCents),
        taxAmount: fromCents(tax.taxCents),
        invoiceDiscountAmount: result.invoiceDiscountAmount,
        panelResponsibilityAmount: result.panelResponsibilityAmount,
        patientResponsibilityAmount: addTax(result.patientResponsibilityAmount, fromCents(tax.taxCents)),
      },
    });
  }

  /**
   * The tax codes an invoice's lines reference, and the tax they produce.
   *
   * Returns zero for everything when nothing is mapped, and does not query at
   * all in that case — the overwhelmingly common path today, and one that must
   * not cost a round trip on every recalculation.
   */
  private async applyTax(
    tx: ClinicalTx,
    input: {
      invoiceCreatedAt: Date;
      lines: {
        id: string;
        amount: unknown;
        lineDiscountAmount: unknown;
        patientResponsibilityAmount: unknown;
        taxCodeId: string | null;
        cancelledAt: Date | null;
      }[];
    },
  ) {
    const codeIds = [...new Set(input.lines.map((line) => line.taxCodeId).filter((id): id is string => !!id))];
    if (codeIds.length === 0) {
      return {
        lines: input.lines.map((line) => ({
          id: line.id,
          taxAmount: 0,
          taxRatePercent: null,
          taxTreatment: null,
        })),
        taxCents: 0,
        unclassifiedLineIds: [],
      };
    }

    const [codes, setting] = await Promise.all([
      tx.taxCode.findMany({ where: { id: { in: codeIds }, active: true }, include: { rates: true } }),
      tx.globalSetting.findFirst({ where: { key: TAX_BASIS_SETTING_KEY }, select: { value: true } }),
    ]);

    const snapshots = new Map<string, TaxCodeSnapshot>(
      codes.map((code) => [
        code.id,
        {
          id: code.id,
          code: code.code,
          treatment: code.treatment,
          rates: code.rates.map((rate) => ({
            ratePercent: rate.ratePercent,
            effectiveFrom: rate.effectiveFrom,
            effectiveTo: rate.effectiveTo,
          })),
        },
      ]),
    );

    return applyInvoiceTax({
      lines: input.lines as never,
      codes: snapshots,
      on: input.invoiceCreatedAt,
      basis: taxBasisFrom(setting?.value),
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
      // §36 — A DEPOSIT TAKEN AT BOOKING IS NOT A SECOND SALE.
      //
      // If this visit came from an appointment whose booking fee was paid, the
      // money is already in the clinic's hands. Recording it here as an amount
      // the PATIENT HAS PAID means the counter asks for the balance and not
      // for the whole bill, and the deposit is not counted twice — once as a
      // booking fee and again as invoice revenue.
      //
      // The link is written on the APPOINTMENT rather than the invoice, so an
      // appointment can never be applied to two invoices: the column is single
      // valued, and `depositInvoiceId: null` in the filter means an already
      // reconciled deposit is skipped on a re-run.
      const deposit = await tx.appointment.findFirst({
        where: {
          visitId: visit.id,
          bookingFeePaidAt: { not: null },
          depositInvoiceId: null,
        },
        select: { id: true, bookingFeeAmount: true },
      });
      if (deposit && Number(deposit.bookingFeeAmount) > 0) {
        await tx.appointment.update({
          where: { id: deposit.id },
          data: { depositInvoiceId: invoice.id },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { patientPaidAmount: deposit.bookingFeeAmount },
        });
        await recordAppointmentEvent(tx, {
          appointmentId: deposit.id,
          eventType: AppointmentEventType.PAYMENT_CHANGED,
          after: { depositInvoiceId: invoice.id, appliedAmount: String(deposit.bookingFeeAmount) },
          reason: 'The booking deposit was applied to the clinic invoice',
        });
      }

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

      // --- Source state and SERVER quantity (D-094, owner decision 10) -----
      // A source-linked line's quantity is the SOURCE'S, never the client's:
      // the prescription's quantity for medication, 1 for orders. And a
      // medication charge is finalisable only for what was actually supplied:
      // DISPENSED + ONSITE_DISPENSE, nothing else, no partial dispensing.
      let quantity = dto.quantity ?? 1;
      if (dto.sourcePrescriptionId) {
        const prescription = await tx.prescription.findUnique({
          where: { id: dto.sourcePrescriptionId },
          select: { status: true, supplyMode: true, quantity: true, deletedAt: true },
        });
        if (!prescription || prescription.deletedAt) {
          throw new NotFoundException('Prescription not found');
        }
        if (prescription.supplyMode !== PrescriptionSupplyMode.ONSITE_DISPENSE) {
          throw new BadRequestException(
            'Only medication the clinic dispenses on site can be charged. This prescription has a different supply mode.',
          );
        }
        if (prescription.status !== PrescriptionStatus.DISPENSED) {
          throw new BadRequestException(
            'This medication has not been dispensed yet. The charge is finalised from what is actually supplied.',
          );
        }
        quantity = prescription.quantity;
      } else if (dto.sourceOrderServiceId) {
        const order = await tx.orderService.findUnique({
          where: { id: dto.sourceOrderServiceId },
          select: { orderType: true, status: true, quantity: true },
        });
        if (!order) {
          throw new NotFoundException('Order not found');
        }
        if (order.status === OrderServiceStatus.CANCELLED) {
          throw new BadRequestException('A cancelled order is not chargeable.');
        }
        if (order.orderType === 'TASK_ORDER' && order.status !== OrderServiceStatus.COMPLETED) {
          throw new BadRequestException('This procedure has not been completed yet, so it cannot be charged.');
        }
        // b2 PHASE E — from the ORDER, the same way a prescription's is.
        //
        // This was hardcoded to 1, so three dressings recorded as a quantity
        // of three were billed once. The quantity is a money fact and it is
        // read from the record rather than assumed; a task order is always one
        // piece of work, and its stored quantity is 1 by construction.
        quantity = order.quantity;
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
        // PIECE 4 — A MEDICINE IS CHARGED IN PACKS.
        //
        // `unitPrice` on a medicine is the price of one STOCK UNIT; the
        // prescription's quantity is in DOSE UNITS. Multiplying them, which is
        // what this did, bills a ten-capsule course of Oseltamivir at
        // RM1,550.00 against a real price of RM155.00. The stored quantity
        // becomes the number of PACKS, which is also what the line then means
        // on a printed bill: "1 x RM155.00", not "10 x RM155.00".
        if (resolved.dispense) {
          if (resolved.dispense.dispenseQuantity === null) {
            // Refused, not guessed. A divisor of 1 assumed here is the same
            // arithmetic that produced the RM1,550, and an invoice line is a
            // charge somebody pays — the draft may list it unpriced, but a
            // real line cannot be created without a number.
            throw new BadRequestException(
              resolved.dispense.reason ??
                'This medicine cannot be priced per dispense until its quantity per stock unit is set.',
            );
          }
          quantity = resolved.dispense.dispenseQuantity;
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
      const taxCodeId = await this.defaultTaxCodeId(tx, {
        sourcePrescriptionId: dto.sourcePrescriptionId,
        sourceOrderServiceId: dto.sourceOrderServiceId,
      });

      await tx.invoiceLine.create({
        data: {
          tenantId: currentTenantId(),
          invoiceId,
          taxCodeId,
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

  // ==========================================================================
  // G4.5d3c-3b2 (D-094) — THE CONSULTATION CHARGE.
  //
  // A consultation fee must never depend on anyone remembering it. Billing
  // Review invokes `ensureConsultationCharge` — a dedicated IDEMPOTENT
  // operation, not a side effect of a read — every time it opens. The visit
  // row is locked FOR UPDATE first, so two concurrent ensures serialise and
  // the loser re-reads the winner's line: repeated page loads, refetches and
  // concurrent requests cannot create a duplicate charge.
  //
  // The automatic path adds ONLY when the resolver says READY. A waived
  // (cancelled) consultation stays waived; an exempt visit stays exempt; a
  // missing tariff becomes a review state, never a guessed price.
  // `addConsultationCharge` is the EXPLICIT counter action for the two owner-
  // approved exceptions: an exempt visit where a real consultation did occur,
  // and a deliberate re-add after a waiver.
  // ==========================================================================
  async ensureConsultationCharge(invoiceId: string) {
    return this.consultationCharge(invoiceId, { explicit: false });
  }

  async addConsultationCharge(invoiceId: string) {
    return this.consultationCharge(invoiceId, { explicit: true });
  }

  private async consultationCharge(invoiceId: string, opts: { explicit: boolean }) {
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
        if (opts.explicit) {
          throw new BadRequestException(`Cannot add a line to an invoice in status ${invoice.status}`);
        }
        return { added: false, state: { kind: 'NOT_APPLICABLE' as const } };
      }

      // Serialise every consultation-charge attempt for this visit.
      await tx.$executeRaw`SELECT id FROM "visits" WHERE id = ${invoice.visitId} FOR UPDATE`;

      const state: ConsultationChargeState = opts.explicit
        ? await resolveExplicitConsultationAdd(tx, invoice.visitId)
        : await resolveConsultationState(tx, invoice.visitId);

      if (state.kind !== 'READY') {
        if (!opts.explicit) {
          return { added: false, state: summariseConsultationState(state) };
        }
        if (state.kind === 'BILLED') {
          throw new ConflictException('A consultation charge already exists for this visit.');
        }
        if (state.kind === 'TARIFF_REVIEW') {
          throw new BadRequestException(`Consultation tariff requires review. ${state.reason}`);
        }
        if (state.kind === 'NOT_CONFIGURED') {
          throw new BadRequestException('No consultation tariff is configured for this clinic.');
        }
        throw new BadRequestException('No consultation occurred on this visit, so there is nothing to charge.');
      }

      const visit = await tx.visit.findUnique({
        where: { id: invoice.visitId },
        select: { panelClinicId: true },
      });
      const panelClinicId = visit?.panelClinicId ?? null;
      const resolved = await resolveSourcedPrice(tx, { panelClinicId, serviceCatalogId: state.service.id });
      if (!resolved) {
        throw new BadRequestException('This item cannot be priced — its catalog record was not found.');
      }
      const exclusion = await this.resolveExclusionFor(tx, panelClinicId, { serviceCatalogId: state.service.id });
      const taxCodeId = await this.defaultTaxCodeId(tx, { serviceCatalogId: state.service.id });

      await tx.invoiceLine.create({
        data: {
          tenantId: currentTenantId(),
          invoiceId,
          taxCodeId,
          description: state.service.name,
          // Server-selected: one consultation, quantity one, always.
          quantity: 1,
          unitPrice: resolved.unitPrice,
          amount: resolved.unitPrice,
          sourceConsultationVisitId: invoice.visitId,
          consultationTariffRuleId: state.rule.id,
          excludedFromPanel: exclusion.excluded,
          panelExclusionReason: exclusion.reason,
          priceRule: resolved.priceRule,
          baseUnitPrice: resolved.baseUnitPrice,
          panelMarkupAmount: resolved.panelMarkupAmount,
        },
      });
      const updated = await this.recalculateInvoice(tx, invoiceId);
      return { added: true, state: { kind: 'BILLED' as const }, invoice: updated };
    });
  }


  /**
   * The DEFAULT tax code for a line, snapshotted at add-time.
   *
   * Resolved from the CATALOGUE entry the line was sourced from — the item
   * behind a dispensed medication, the service behind a procedure. A manual
   * freehand line has no catalogue entry and therefore no tax classification;
   * it reports as unclassified rather than inheriting a neighbouring line's
   * treatment.
   *
   * Snapshotted rather than looked up live at report time, for the same reason
   * description and unit price are: re-classifying an item next March must not
   * silently change the tax on a bill issued last March.
   */
  private async defaultTaxCodeId(
    tx: ClinicalTx,
    source: { sourcePrescriptionId?: string | null; sourceOrderServiceId?: string | null; serviceCatalogId?: string | null },
  ): Promise<string | null> {
    if (source.sourcePrescriptionId) {
      const prescription = await tx.prescription.findUnique({
        where: { id: source.sourcePrescriptionId },
        select: { item: { select: { taxCodeId: true } } },
      });
      return prescription?.item?.taxCodeId ?? null;
    }
    const serviceCatalogId =
      source.serviceCatalogId ??
      (source.sourceOrderServiceId
        ? (
            await tx.orderService.findUnique({
              where: { id: source.sourceOrderServiceId },
              select: { serviceCatalogId: true },
            })
          )?.serviceCatalogId
        : null);
    if (!serviceCatalogId) return null;
    const service = await tx.serviceCatalog.findUnique({
      where: { id: serviceCatalogId },
      select: { taxCodeId: true },
    });
    return service?.taxCodeId ?? null;
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
    return this.resolveExclusionFor(tx, panelClinicId, { itemId, serviceCatalogId });
  }

  private async resolveExclusionFor(
    tx: ClinicalTx,
    panelClinicId: string | null,
    source: { itemId?: string; serviceCatalogId?: string },
  ): Promise<{ excluded: boolean; reason: string | null }> {
    if (!panelClinicId) return { excluded: false, reason: null };
    if (!source.itemId && !source.serviceCatalogId) return { excluded: false, reason: null };
    const match = await tx.panelExclusion.findFirst({
      where: {
        panelClinicId,
        ...(source.itemId ? { itemId: source.itemId } : {}),
        ...(source.serviceCatalogId ? { serviceCatalogId: source.serviceCatalogId } : {}),
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
  async cancelLine(invoiceId: string, lineId: string, dto: CancelInvoiceLineDto) {
    // D-094 — CANCEL_LINE, not EDIT_LINES: counter staff and finance may
    // correct a bill (including waiving an auto-added consultation); doctors
    // do not manage billing corrections from the clinical surface.
    const actor = await this.authoriseBilling('CANCEL_LINE', await this.invoiceVisitId(invoiceId));
    const reason = dto.cancelReason?.trim();
    if (!reason) {
      throw new BadRequestException('A reason is required to cancel an invoice line.');
    }
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
          cancelReason: reason,
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
    return withTenantTx(this.rawPrisma, async (tx) => {
      const cancelled = await tx.invoice.update({
        where: { id },
        data: { status: InvoiceStatus.CANCELLED, cancelReason: dto.cancelReason },
      });
      // §36 — a deposit applied to THIS invoice is released back to its
      // appointment, in the same transaction. Without this the single-valued
      // link stayed pointed at a CANCELLED invoice: the replacement invoice's
      // reconciliation (which filters depositInvoiceId: null, precisely so a
      // deposit is never applied twice) skipped it, and the counter asked the
      // patient for money the clinic already held.
      const deposits = await tx.appointment.findMany({
        where: { depositInvoiceId: id },
        select: { id: true, bookingFeeAmount: true },
      });
      for (const deposit of deposits) {
        await tx.appointment.update({
          where: { id: deposit.id },
          data: { depositInvoiceId: null },
        });
        await recordAppointmentEvent(tx, {
          appointmentId: deposit.id,
          eventType: AppointmentEventType.PAYMENT_CHANGED,
          before: { depositInvoiceId: id },
          after: { depositInvoiceId: null, releasedAmount: String(deposit.bookingFeeAmount) },
          reason: 'The invoice holding this deposit was cancelled; the deposit is available again',
        });
      }
      return cancelled;
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
    const actor = await this.authoriseBilling('MARK_PAID', await this.invoiceVisitId(id));
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

      // D-094 — settlement is refused while billing work is knowably
      // incomplete: a ready-but-unbilled source, or a consultation the tariff
      // cannot resolve. Paying first and discovering the gap later is the
      // exact workflow this checkpoint exists to end.
      const worklist = await collectBillingWorklist(tx, invoice.visitId);
      const unbilled = unbilledReadyItems(worklist);
      if (unbilled.length > 0) {
        throw new BadRequestException(
          `Billing work is not complete — uninvoiced: ${unbilled.map((item) => item.description).join(', ')}.`,
        );
      }
      if (tariffReviewItems(worklist).length > 0) {
        throw new BadRequestException('Consultation tariff requires review.');
      }

      const patientResponsibility = Number(invoice.patientResponsibilityAmount);
      if (dto.paymentMethod === 'PANEL' && patientResponsibility > 0) {
        throw new BadRequestException(
          `Cannot mark as fully covered by panel — a patient copay of ${patientResponsibility} is still due`,
        );
      }
      // PANEL means "the PANEL carries this bill and the patient pays
      // nothing" — meaningless unless the panel actually carries something.
      if (dto.paymentMethod === 'PANEL' && Number(invoice.panelResponsibilityAmount ?? 0) <= 0) {
        throw new BadRequestException(
          'Panel — No Patient Payment applies only when the panel carries a positive amount.',
        );
      }

      // WAVE 1 — this is still the FULL-SETTLEMENT path, and it stays that
      // way: the counter's "mark paid" button means "the patient has paid what
      // they owe", and changing that button's meaning would be a change to the
      // clinical workflow, not to finance. What changed is that the settlement
      // now ALSO writes a `Payment` row, so the same act produces both the
      // legacy columns every existing report reads and a ledger entry the
      // day-end can reconcile, a partial payment can be added to, and a refund
      // can be taken against.
      //
      // Partial tender enters through `POST /finance/invoices/:id/payments`,
      // which writes the same ledger and then derives these columns back. Two
      // entry points, ONE representation.
      const patientPaidAmount = dto.paymentMethod === 'PANEL' ? 0 : patientResponsibility;
      const paidAt = new Date();

      // Deposits taken at booking were already credited to
      // `patientPaidAmount` at invoice creation. The ledger row records only
      // what moves at the counter NOW, so the deposit is not banked twice.
      const alreadyReceived = await tx.payment.aggregate({
        where: { invoiceId: id, reversedAt: null, kind: PaymentKind.PAYMENT },
        _sum: { amount: true },
      });
      const alreadyReceivedCents = toCents(alreadyReceived._sum.amount ?? 0);
      const collectedNowCents = toCents(patientPaidAmount) - alreadyReceivedCents;

      if (collectedNowCents > 0) {
        const clinicVisit = await tx.visit.findUnique({
          where: { id: invoice.visitId },
          select: { clinicId: true },
        });
        await tx.payment.create({
          data: {
            tenantId: currentTenantId(),
            clinicId: clinicVisit!.clinicId,
            invoiceId: id,
            kind: PaymentKind.PAYMENT,
            tender: PaymentService.tenderOf(dto.paymentMethod),
            methodLabel: dto.paymentMethod,
            amount: fromCents(collectedNowCents),
            receivedAt: paidAt,
            receivedByStaffId: actor.id,
          },
        });
      }

      return tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.PAID,
          paidAt,
          paymentMethod: dto.paymentMethod,
          panelCoveredAmount: Number(invoice.panelResponsibilityAmount ?? 0),
          patientPaidAmount,
        },
      });
    });
  }
}

/** The ensure-op's answer to the browser: what the state is, in one word. */
function summariseConsultationState(state: ConsultationChargeState): { kind: ConsultationChargeState['kind']; reason?: string } {
  return state.kind === 'TARIFF_REVIEW' ? { kind: state.kind, reason: state.reason } : { kind: state.kind };
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
