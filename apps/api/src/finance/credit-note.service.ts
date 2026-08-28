import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreditNoteStatus, InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, resolveClinicId, withAdminTx } from './admin-actor';
import { recordAudit } from './admin-audit';
import { fromCents, sumCents, toCents } from './money';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { VoidCreditNoteDto } from './dto/void-credit-note.dto';

/**
 * CREDIT NOTES — correcting revenue without destroying what was billed.
 *
 * The alternative, which this exists to make unnecessary, is editing or
 * deleting the invoice. That makes a clinic's reported revenue unauditable:
 * the number changes and nothing says why. A credit note leaves the original
 * invoice exactly as issued and records the reduction as its own dated,
 * attributed, approvable document.
 *
 * THE TWO-PERSON RULE: raising a credit note and approving it are separate
 * permissions. A DRAFT reduces nothing — only an ISSUED note counts against
 * the balance (see `financial-invariants.creditedCents`), and only somebody
 * holding `creditNote.approve` can move it there.
 */
@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  private async nextNumber(tx: AdminTx): Promise<string> {
    // Same count-based sequence and same accepted race gap as Invoice and
    // Visit numbering. Kept identical rather than improved in isolation: three
    // allocators with two different behaviours is worse than three with one.
    const count = await tx.creditNote.count();
    return `CN-${String(count + 1).padStart(6, '0')}`;
  }

  async create(dto: CreateCreditNoteDto) {
    return withAdminTx(this.rawPrisma, 'creditNote.create', async (tx, actor) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: dto.invoiceId },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          patientResponsibilityAmount: true,
          visit: { select: { clinicId: true } },
          lines: {
            where: { cancelledAt: null },
            select: { id: true, description: true, amount: true, lineDiscountAmount: true, taxAmount: true },
          },
        },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('A cancelled invoice has nothing left to credit.');
      }
      const clinicId = resolveClinicId(actor, invoice.visit.clinicId);

      const lineById = new Map(invoice.lines.map((line) => [line.id, line]));
      const lines = dto.lines.map((input) => {
        if (input.invoiceLineId) {
          const source = lineById.get(input.invoiceLineId);
          if (!source) {
            throw new BadRequestException('That invoice line does not belong to this invoice, or has been cancelled.');
          }
        }
        const amountCents = toCents(input.amount);
        if (amountCents <= 0) {
          throw new BadRequestException('Every credit line must be for a positive amount.');
        }
        return {
          invoiceLineId: input.invoiceLineId ?? null,
          description: input.description,
          quantity: input.quantity ?? 1,
          unitPrice: input.amount,
          amount: input.amount,
          taxAmount: input.taxAmount ?? '0',
        };
      });

      const subtotalCents = sumCents(lines.map((line) => line.amount));
      const taxCents = sumCents(lines.map((line) => line.taxAmount));
      const totalCents = subtotalCents + taxCents;

      // A credit note cannot exceed the invoice. Crediting RM300 against an
      // RM200 bill is not a correction, it is a payment out, and it belongs in
      // the refund path where it is reconciled against money actually taken.
      const alreadyCredited = await tx.creditNote.aggregate({
        where: { invoiceId: invoice.id, status: CreditNoteStatus.ISSUED },
        _sum: { totalAmount: true },
      });
      const headroomCents = toCents(invoice.totalAmount) - toCents(alreadyCredited._sum.totalAmount ?? 0);
      if (totalCents > headroomCents) {
        throw new BadRequestException(
          `A credit of ${fromCents(totalCents)} exceeds the ${fromCents(headroomCents)} still creditable on this invoice.`,
        );
      }

      const note = await tx.creditNote.create({
        data: {
          tenantId: currentTenantId(),
          clinicId,
          creditNoteNumber: await this.nextNumber(tx),
          invoiceId: invoice.id,
          status: CreditNoteStatus.DRAFT,
          reason: dto.reason,
          subtotalAmount: fromCents(subtotalCents),
          taxAmount: fromCents(taxCents),
          totalAmount: fromCents(totalCents),
          createdByStaffId: actor.id,
          lines: { create: lines.map((line) => ({ ...line, tenantId: currentTenantId() })) },
        },
        include: { lines: true },
      });

      await recordAudit(tx, actor, {
        action: 'creditNote.created',
        entityType: 'CreditNote',
        entityId: note.id,
        after: {
          creditNoteNumber: note.creditNoteNumber,
          invoiceId: invoice.id,
          total: fromCents(totalCents),
          status: CreditNoteStatus.DRAFT,
        },
        reason: dto.reason,
        source: 'finance.creditNotes',
      });

      return note;
    });
  }

  /** Approve and issue. Only from here does a credit note reduce anything. */
  async approve(id: string) {
    return withAdminTx(this.rawPrisma, 'creditNote.approve', async (tx, actor) => {
      const note = await tx.creditNote.findUnique({
        where: { id },
        select: { id: true, status: true, createdByStaffId: true, totalAmount: true, invoiceId: true, creditNoteNumber: true },
      });
      if (!note) throw new NotFoundException('Credit note not found');
      if (note.status !== CreditNoteStatus.DRAFT) {
        throw new BadRequestException(`A ${note.status.toLowerCase()} credit note cannot be approved.`);
      }

      const issued = await tx.creditNote.update({
        where: { id },
        data: {
          status: CreditNoteStatus.ISSUED,
          approvedByStaffId: actor.id,
          approvedAt: new Date(),
          issuedAt: new Date(),
        },
      });

      await recordAudit(tx, actor, {
        action: 'creditNote.approved',
        entityType: 'CreditNote',
        entityId: id,
        before: { status: CreditNoteStatus.DRAFT },
        after: {
          status: CreditNoteStatus.ISSUED,
          total: String(note.totalAmount),
          creditNoteNumber: note.creditNoteNumber,
          raisedBy: note.createdByStaffId,
        },
        source: 'finance.creditNotes',
      });

      return issued;
    });
  }

  /** Withdraw a credit note. It stays on the record, marked VOID with a reason. */
  async void(id: string, dto: VoidCreditNoteDto) {
    return withAdminTx(this.rawPrisma, 'creditNote.approve', async (tx, actor) => {
      const note = await tx.creditNote.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!note) throw new NotFoundException('Credit note not found');
      if (note.status === CreditNoteStatus.VOID) {
        throw new BadRequestException('This credit note is already void.');
      }

      const voided = await tx.creditNote.update({
        where: { id },
        data: {
          status: CreditNoteStatus.VOID,
          voidedByStaffId: actor.id,
          voidedAt: new Date(),
          voidReason: dto.reason,
        },
      });

      await recordAudit(tx, actor, {
        action: 'creditNote.voided',
        entityType: 'CreditNote',
        entityId: id,
        before: { status: note.status },
        after: { status: CreditNoteStatus.VOID },
        reason: dto.reason,
        source: 'finance.creditNotes',
      });

      return voided;
    });
  }

  async list(params: { clinicId?: string; status?: CreditNoteStatus; from?: string; to?: string }) {
    const actor = await requirePermission(this.rawPrisma, 'finance.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const notes = await this.prisma.creditNote.findMany({
      where: {
        ...(clinicId ? { clinicId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.from || params.to
          ? {
              createdAt: {
                ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
                ...(params.to ? { lt: new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        lines: true,
        createdBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            totalAmount: true,
            visit: { select: { visitNumber: true, patient: { select: { name: true } } } },
          },
        },
      },
    });

    return notes.map((note) => ({
      id: note.id,
      creditNoteNumber: note.creditNoteNumber,
      status: note.status,
      reason: note.reason,
      subtotalAmount: Number(note.subtotalAmount),
      taxAmount: Number(note.taxAmount),
      totalAmount: Number(note.totalAmount),
      createdAt: note.createdAt,
      issuedAt: note.issuedAt,
      voidReason: note.voidReason,
      createdBy: note.createdBy?.fullName ?? null,
      approvedBy: note.approvedBy?.fullName ?? null,
      invoiceNumber: note.invoice?.invoiceNumber ?? null,
      invoiceTotal: note.invoice ? Number(note.invoice.totalAmount) : null,
      patientName: note.invoice?.visit?.patient?.name ?? null,
      visitNumber: note.invoice?.visit?.visitNumber ?? null,
      lines: note.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        amount: Number(line.amount),
        taxAmount: Number(line.taxAmount),
      })),
    }));
  }
}
