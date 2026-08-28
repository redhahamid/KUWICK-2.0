import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TaxTreatment } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from './admin-actor';
import { recordAudit } from './admin-audit';
import { fromCents, toCents } from './money';
import { TaxCodeSnapshot, computeLineTax, rateInForce, summariseTax } from './tax';
import { UpsertTaxCodeDto } from './dto/upsert-tax-code.dto';
import { AddTaxRateDto } from './dto/add-tax-rate.dto';

/**
 * TAX CONFIGURATION AND THE TAX REPORT.
 *
 * The computation itself lives in `tax.ts` as pure functions; this is the part
 * that talks to the database. The split is deliberate — the arithmetic is what
 * needs exhaustive testing, and it should be testable without a Postgres.
 *
 * A NOTE ON WHAT THIS DOES NOT CLAIM: nothing here decides Malaysian SST law.
 * It applies the rates and treatments a clinic configures, on the dates they
 * configure them for. An unmapped item produces an unmapped line and appears
 * in the report's "not classified" total rather than in either the taxable or
 * the exempt one.
 */
@Injectable()
export class TaxService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async listCodes() {
    await requirePermission(this.rawPrisma, 'finance.view');
    const codes = await this.prisma.taxCode.findMany({
      orderBy: { code: 'asc' },
      include: { rates: { orderBy: { effectiveFrom: 'desc' } } },
    });
    const today = new Date();
    return codes.map((code) => ({
      id: code.id,
      code: code.code,
      name: code.name,
      treatment: code.treatment,
      active: code.active,
      currentRate:
        code.treatment === TaxTreatment.STANDARD_RATED
          ? rateInForce(
              code.rates.map((rate) => ({
                ratePercent: rate.ratePercent,
                effectiveFrom: rate.effectiveFrom,
                effectiveTo: rate.effectiveTo,
              })),
              today,
            )
          : 0,
      rates: code.rates.map((rate) => ({
        id: rate.id,
        ratePercent: Number(rate.ratePercent),
        effectiveFrom: rate.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: rate.effectiveTo?.toISOString().slice(0, 10) ?? null,
      })),
    }));
  }

  async upsertCode(dto: UpsertTaxCodeDto) {
    return withAdminTx(this.rawPrisma, 'finance.configure', async (tx, actor) => {
      const existing = dto.id ? await tx.taxCode.findUnique({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Tax code not found');

      const saved = existing
        ? await tx.taxCode.update({
            where: { id: existing.id },
            data: { code: dto.code, name: dto.name, treatment: dto.treatment, active: dto.active ?? existing.active },
          })
        : await tx.taxCode.create({
            data: {
              tenantId: currentTenantId(),
              code: dto.code,
              name: dto.name,
              treatment: dto.treatment,
              active: dto.active ?? true,
            },
          });

      await recordAudit(tx, actor, {
        action: 'taxCode.changed',
        entityType: 'TaxCode',
        entityId: saved.id,
        before: existing ? { code: existing.code, treatment: existing.treatment, active: existing.active } : null,
        after: { code: saved.code, treatment: saved.treatment, active: saved.active },
        source: 'finance.tax',
      });
      return saved;
    });
  }

  /**
   * Add a rate with a start date.
   *
   * Closing the previous open-ended rate is done HERE rather than left to the
   * user, because two overlapping open rates is a configuration a clinic
   * cannot see and `rateInForce` would silently resolve by picking the later
   * start. The previous rate ends the day before this one begins.
   */
  async addRate(taxCodeId: string, dto: AddTaxRateDto) {
    return withAdminTx(this.rawPrisma, 'finance.configure', async (tx, actor) => {
      const code = await tx.taxCode.findUnique({ where: { id: taxCodeId }, select: { id: true, treatment: true } });
      if (!code) throw new NotFoundException('Tax code not found');
      if (code.treatment !== TaxTreatment.STANDARD_RATED) {
        throw new BadRequestException('Only a standard-rated code carries a rate.');
      }

      const effectiveFrom = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      const openEnded = await tx.taxRate.findFirst({
        where: { taxCodeId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (openEnded) {
        if (openEnded.effectiveFrom >= effectiveFrom) {
          throw new BadRequestException('A rate already starts on or after that date. Rates cannot be back-dated over one another.');
        }
        await tx.taxRate.update({
          where: { id: openEnded.id },
          data: { effectiveTo: new Date(effectiveFrom.getTime() - 86400000) },
        });
      }

      const rate = await tx.taxRate.create({
        data: { tenantId: currentTenantId(), taxCodeId, ratePercent: dto.ratePercent, effectiveFrom },
      });

      await recordAudit(tx, actor, {
        action: 'taxCode.changed',
        entityType: 'TaxRate',
        entityId: rate.id,
        before: openEnded ? { previousRate: String(openEnded.ratePercent), closedOn: openEnded.effectiveTo } : null,
        after: { taxCodeId, ratePercent: dto.ratePercent, effectiveFrom: dto.effectiveFrom },
        source: 'finance.tax',
      });
      return rate;
    });
  }

  /** A tax code as the pure calculator wants it. */
  async snapshotOf(taxCodeId: string | null | undefined): Promise<TaxCodeSnapshot | null> {
    if (!taxCodeId) return null;
    const code = await this.prisma.taxCode.findUnique({
      where: { id: taxCodeId },
      include: { rates: true },
    });
    if (!code || !code.active) return null;
    return {
      id: code.id,
      code: code.code,
      treatment: code.treatment,
      rates: code.rates.map((rate) => ({
        ratePercent: rate.ratePercent,
        effectiveFrom: rate.effectiveFrom,
        effectiveTo: rate.effectiveTo,
      })),
    };
  }

  /**
   * THE TAX REPORT.
   *
   * Summed from what was actually CHARGED on each line — the snapshotted
   * `taxAmount` — never by applying today's rate to a period's revenue. An
   * invoice raised before a rate change must report at the rate it charged.
   */
  async report(params: { clinicId?: string; from: string; to: string }) {
    const actor = await requirePermission(this.rawPrisma, 'finance.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000);

    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        cancelledAt: null,
        invoice: {
          status: { not: 'CANCELLED' },
          createdAt: { gte: from, lt: to },
          ...(clinicId ? { visit: { clinicId } } : {}),
        },
      },
      select: {
        id: true,
        description: true,
        amount: true,
        lineDiscountAmount: true,
        taxAmount: true,
        taxTreatment: true,
        taxRatePercent: true,
        taxCodeId: true,
        taxCode: { select: { code: true, name: true } },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            createdAt: true,
            visit: { select: { clinicId: true, patient: { select: { name: true } } } },
          },
        },
      },
    });

    const summary = summariseTax(
      lines.map((line) => ({
        taxCodeId: line.taxCodeId,
        treatment: line.taxTreatment,
        ratePercent: line.taxRatePercent === null ? null : Number(line.taxRatePercent),
        taxableBaseCents: toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0),
        taxCents: toCents(line.taxAmount),
        unmapped: line.taxCodeId === null,
      })),
      lines.map((line) => toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0)),
    );

    // Per-code breakdown, for the return the clinic actually files.
    const byCode = new Map<string, { code: string; name: string; baseCents: number; taxCents: number; lines: number }>();
    for (const line of lines) {
      const key = line.taxCode?.code ?? 'UNMAPPED';
      const bucket = byCode.get(key) ?? {
        code: key,
        name: line.taxCode?.name ?? 'Not classified for tax',
        baseCents: 0,
        taxCents: 0,
        lines: 0,
      };
      bucket.baseCents += toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0);
      bucket.taxCents += toCents(line.taxAmount);
      bucket.lines += 1;
      byCode.set(key, bucket);
    }

    // Per-invoice, for the per-bill view the report needs.
    const byInvoice = new Map<string, { invoiceNumber: string; date: Date; patient: string | null; baseCents: number; taxCents: number }>();
    for (const line of lines) {
      const invoice = line.invoice;
      const bucket = byInvoice.get(invoice.id) ?? {
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.createdAt,
        patient: invoice.visit?.patient?.name ?? null,
        baseCents: 0,
        taxCents: 0,
      };
      bucket.baseCents += toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0);
      bucket.taxCents += toCents(line.taxAmount);
      byInvoice.set(invoice.id, bucket);
    }

    return {
      from: params.from,
      to: params.to,
      summary: {
        taxable: fromCents(summary.taxableCents),
        tax: fromCents(summary.taxCents),
        grossTaxable: fromCents(summary.grossTaxableCents),
        zeroRated: fromCents(summary.zeroRatedCents),
        exempt: fromCents(summary.exemptCents),
        notClassified: fromCents(summary.unmappedCents),
        lineCount: lines.length,
      },
      byCode: [...byCode.values()]
        .map((bucket) => ({
          code: bucket.code,
          name: bucket.name,
          base: fromCents(bucket.baseCents),
          tax: fromCents(bucket.taxCents),
          lines: bucket.lines,
        }))
        .sort((a, b) => b.tax - a.tax || a.code.localeCompare(b.code)),
      byInvoice: [...byInvoice.entries()]
        .map(([id, bucket]) => ({
          invoiceId: id,
          invoiceNumber: bucket.invoiceNumber,
          date: bucket.date,
          patient: bucket.patient,
          base: fromCents(bucket.baseCents),
          tax: fromCents(bucket.taxCents),
        }))
        .filter((row) => row.tax !== 0)
        .sort((a, b) => b.date.getTime() - a.date.getTime()),
    };
  }

  /** Re-exported so the invoice service computes tax through one implementation. */
  static computeLineTax = computeLineTax;
}
