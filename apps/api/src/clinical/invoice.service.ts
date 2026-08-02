import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { AddInvoiceLineDto } from './dto/add-invoice-line.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { PayInvoiceDto } from './dto/pay-invoice.dto';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly visits: VisitService,
  ) {}

  // Count-based sequence ("INV-000002"), same accepted non-atomic-race gap
  // as Visit.visitNumber.
  private async nextInvoiceNumber(): Promise<string> {
    const count = await this.prisma.invoice.count();
    return `INV-${String(count + 1).padStart(6, '0')}`;
  }

  // createdByStaffId is caller-supplied, not defaulted from the visit —
  // invoice creation is deliberately staff-creatable (not gated to the
  // visit's own attending doctor) so a locum covering the queue can bill
  // a visit that isn't "theirs".
  async create(dto: CreateInvoiceDto) {
    const visit = await this.visits.findById(dto.visitId);
    return this.prisma.invoice.create({
      data: {
        tenantId: currentTenantId(),
        visitId: visit.id,
        createdByStaffId: dto.createdByStaffId,
        invoiceNumber: await this.nextInvoiceNumber(),
      },
    });
  }

  /**
   * G3c (D-065) — the read the Clinical Workspace's Invoice Summary uses.
   *
   * Two corrections, both read-only:
   *
   * **Branch access is now enforced.** Tenant isolation came from RLS on the
   * scoped client, but nothing checked the BRANCH: a staff member authorised
   * only for Branch A could read Branch B's invoices for any visit id they
   * could name. Every clinical read added since C0 goes through
   * `assertMayTouchVisit`; the money did not. It does now, and the guard
   * fails closed exactly as C0 specified.
   *
   * **It resolves what the summary must show without a second round trip:**
   * who raised the invoice, the visit's panel (the panel lives on the VISIT,
   * not the invoice), each line's source order/prescription so a doctor can
   * see what a charge came from, and any panel-claim lines — claim status is
   * a separate lifecycle from payment status and must never be folded into
   * one badge.
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

  private async recalculateTotal(invoiceId: string) {
    const lines = await this.prisma.invoiceLine.findMany({ where: { invoiceId } });
    const totalAmount = round2(lines.reduce((sum, line) => sum + Number(line.amount), 0));
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { totalAmount } });
  }

  // Resolves whether a Quick-Added line's source item/service is on the
  // visit's panel's exclusion list — computed server-side (not trusted from
  // the client) so the copay total is always correct even if the frontend's
  // own exclusion list is stale. Freehand lines (no source id) are never
  // auto-excluded; staff can still hand-flag those by billing them as a
  // separate line if needed.
  private async resolveExcludedFromPanel(
    panelClinicId: string | null,
    dto: AddInvoiceLineDto,
  ): Promise<boolean> {
    if (!panelClinicId) return false;
    let itemId: string | undefined;
    let serviceCatalogId: string | undefined;
    if (dto.sourcePrescriptionId) {
      const prescription = await this.prisma.prescription.findUnique({
        where: { id: dto.sourcePrescriptionId },
        select: { itemId: true },
      });
      itemId = prescription?.itemId;
    } else if (dto.sourceOrderServiceId) {
      const orderService = await this.prisma.orderService.findUnique({
        where: { id: dto.sourceOrderServiceId },
        select: { serviceCatalogId: true },
      });
      serviceCatalogId = orderService?.serviceCatalogId;
    } else {
      return false;
    }
    if (!itemId && !serviceCatalogId) return false;
    const match = await this.prisma.panelExclusion.findFirst({
      where: {
        panelClinicId,
        ...(itemId ? { itemId } : {}),
        ...(serviceCatalogId ? { serviceCatalogId } : {}),
      },
    });
    return Boolean(match);
  }

  async addLine(invoiceId: string, dto: AddInvoiceLineDto) {
    const invoice = await this.findById(invoiceId);
    if (invoice.status !== InvoiceStatus.UNPAID) {
      throw new BadRequestException(`Cannot add a line to an invoice in status ${invoice.status}`);
    }
    const visit = await this.prisma.visit.findUnique({
      where: { id: invoice.visitId },
      select: { panelClinicId: true },
    });
    const quantity = dto.quantity ?? 1;
    const amount = round2(quantity * dto.unitPrice);
    const excludedFromPanel = await this.resolveExcludedFromPanel(visit?.panelClinicId ?? null, dto);
    await this.prisma.invoiceLine.create({
      data: {
        tenantId: currentTenantId(),
        invoiceId,
        description: dto.description,
        quantity,
        unitPrice: dto.unitPrice,
        amount,
        sourceOrderServiceId: dto.sourceOrderServiceId,
        sourcePrescriptionId: dto.sourcePrescriptionId,
        excludedFromPanel,
      },
    });
    return this.recalculateTotal(invoiceId);
  }

  async removeLine(invoiceId: string, lineId: string) {
    const invoice = await this.findById(invoiceId);
    if (invoice.status !== InvoiceStatus.UNPAID) {
      throw new BadRequestException(`Cannot remove a line from an invoice in status ${invoice.status}`);
    }
    const line = invoice.lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      throw new NotFoundException('Invoice line not found');
    }
    await this.prisma.invoiceLine.delete({ where: { id: lineId } });
    return this.recalculateTotal(invoiceId);
  }

  async cancel(id: string, dto: CancelInvoiceDto) {
    const invoice = await this.findById(id);
    if (invoice.status !== InvoiceStatus.UNPAID) {
      throw new BadRequestException(`Cannot cancel an invoice in status ${invoice.status}`);
    }
    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED, cancelReason: dto.cancelReason },
    });
  }

  // Phase 1e — the same Panel-Covers/Patient-Copay split InvoiceTab.tsx
  // computes live for an UNPAID invoice's preview, recomputed here so it can
  // be snapshotted onto the Invoice at the moment it's actually paid (never
  // trusted from the client). Excluded lines are always patient-payable, on
  // top of (not netted against) the panel's per-visit limit — same rule the
  // frontend preview uses.
  private async computePanelSplit(invoice: {
    visitId: string;
    totalAmount: unknown;
    lines: { amount: unknown; excludedFromPanel: boolean }[];
  }): Promise<{ panelCoveredAmount: number; patientCopay: number }> {
    const visit = await this.prisma.visit.findUnique({
      where: { id: invoice.visitId },
      select: { panelClinicId: true },
    });
    const totalAmount = Number(invoice.totalAmount);
    if (!visit?.panelClinicId) {
      return { panelCoveredAmount: 0, patientCopay: totalAmount };
    }
    const panel = await this.prisma.panelClinic.findUnique({
      where: { id: visit.panelClinicId },
      select: { limitAmount: true },
    });
    const excludedTotal = round2(
      invoice.lines.filter((line) => line.excludedFromPanel).reduce((sum, line) => sum + Number(line.amount), 0),
    );
    const coveredTotal = round2(totalAmount - excludedTotal);
    const limit = panel?.limitAmount != null ? Number(panel.limitAmount) : undefined;
    const panelCoveredAmount = round2(limit != null ? Math.min(coveredTotal, limit) : coveredTotal);
    const patientCopay = round2(coveredTotal - panelCoveredAmount + excludedTotal);
    return { panelCoveredAmount, patientCopay };
  }

  // Dispensary payment step (Phase A6, extended Phase 1e). Only UNPAID ->
  // PAID; once paid, lines are locked (addLine/removeLine both assert
  // UNPAID) so the billed amount is fixed. panelCoveredAmount/
  // patientPaidAmount are computed here and never recomputed afterward —
  // ClaimBatchLine reads panelCoveredAmount as the fixed amount to claim.
  // paymentMethod 'PANEL' ("Mark Fully Covered by Panel") is only valid
  // when the computed copay is actually zero — the frontend already hides
  // that action otherwise, this is the server-side backstop.
  async pay(id: string, dto: PayInvoiceDto) {
    const invoice = await this.findById(id);
    if (invoice.status !== InvoiceStatus.UNPAID) {
      throw new BadRequestException(`Cannot mark an invoice in status ${invoice.status} as paid`);
    }
    const { panelCoveredAmount, patientCopay } = await this.computePanelSplit(invoice);
    if (dto.paymentMethod === 'PANEL' && patientCopay > 0) {
      throw new BadRequestException(
        `Cannot mark as fully covered by panel — a patient copay of ${patientCopay} is still due`,
      );
    }
    const patientPaidAmount = dto.paymentMethod === 'PANEL' ? 0 : patientCopay;
    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: new Date(),
        paymentMethod: dto.paymentMethod,
        panelCoveredAmount,
        patientPaidAmount,
      },
    });
  }
}
