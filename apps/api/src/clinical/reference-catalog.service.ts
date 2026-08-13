import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogOrigin } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';

/**
 * b1 PHASE 1 — the five prescription reference catalogues, behind one service.
 *
 * ONE service rather than five, deliberately, and against this codebase's usual
 * one-resource-one-service habit. The five differ only in their columns: every
 * one of them lists active rows, accepts a CUSTOM row from the clinic, edits and
 * retires only CUSTOM rows, and refuses SYSTEM rows. Five hand-written copies of
 * that rule is five places for it to drift, and the rule is the whole point —
 * the credentialing helper and the pricing resolver are in this repo for exactly
 * the same reason.
 *
 * WHAT "SYSTEM" MEANS HERE, precisely:
 *
 *   - the clinic's channel is this API, and it REFUSES to touch a SYSTEM row;
 *   - the platform's channel is `prisma/seed-reference-catalogs.ts`, which
 *     repairs SYSTEM rows on every run.
 *
 * Those are different channels on purpose. Do not "fix" a seeding problem by
 * relaxing this service, and do not make the seeder go through it.
 *
 * NOTHING IS DELETED. Retiring sets `active = false`. The tables also carry
 * BEFORE DELETE and BEFORE TRUNCATE triggers, so a hard delete is refused by
 * PostgreSQL regardless of who is connected — including a superuser, which is
 * what the local and CI roles actually are.
 */

/**
 * The four operations every one of these catalogues supports.
 *
 * Prisma generates a DIFFERENT delegate type per model, and their signatures are
 * not structurally compatible, so the union of five delegates is not callable —
 * `findMany` on it has five overloads none of which accept the others' args.
 * This is the narrow shape they genuinely share, and each delegate is cast to it
 * in exactly one place (`table()`), where the columns are also declared. The
 * cast buys the single rule this whole service exists to hold; scattering it
 * would not be worth it.
 */
interface CatalogRow {
  id: string;
  tenantId: string;
  origin: CatalogOrigin;
  active: boolean;
}

interface CatalogDelegate {
  findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<CatalogRow[]>;
  findUnique(args: { where: { id: string } }): Promise<CatalogRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<CatalogRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CatalogRow>;
}

const asCatalog = (delegate: unknown): CatalogDelegate => delegate as CatalogDelegate;

/** The catalogues this service serves, and what identifies a row in each. */
export const REFERENCE_CATALOGS = {
  frequencies: 'frequencies',
  'dosage-units': 'dosage-units',
  'consumption-methods': 'consumption-methods',
  indications: 'indications',
  'stock-units': 'stock-units',
} as const;

export type ReferenceCatalogName = keyof typeof REFERENCE_CATALOGS;

export function isReferenceCatalog(value: string): value is ReferenceCatalogName {
  return Object.prototype.hasOwnProperty.call(REFERENCE_CATALOGS, value);
}

/**
 * The clinic may not add to `stock-units`.
 *
 * The number a clinic types beside a stock unit is what deduction arithmetic
 * multiplies by, so the WORD has to mean the same thing everywhere. A
 * clinic-invented packaging term is a deduction nobody can check.
 */
const PLATFORM_ONLY: ReferenceCatalogName[] = ['stock-units'];

/** Refusal wording, in the house style: the ACCOUNT is never blamed for this. */
const SYSTEM_ROW_REFUSAL =
  'This is a standard entry provided with Kuwick and cannot be changed. Add your own entry instead.';
const PLATFORM_ONLY_REFUSAL =
  'This list is fixed because stock deduction depends on it. Choose the closest entry and set the quantity on the medicine.';

@Injectable()
export class ReferenceCatalogService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  /** The Prisma delegate and the fields each catalogue accepts. */
  private table(catalog: ReferenceCatalogName) {
    switch (catalog) {
      case 'frequencies':
        return {
          delegate: asCatalog(this.prisma.prescriptionFrequency),
          fields: ['code', 'doctorDisplay', 'patientLabelBm', 'timesPerDay'] as const,
          required: ['code', 'doctorDisplay', 'patientLabelBm'] as const,
        };
      case 'dosage-units':
        return {
          delegate: asCatalog(this.prisma.dosageUnit),
          fields: ['systemNameEn', 'patientLabelBm', 'useCase'] as const,
          required: ['systemNameEn', 'patientLabelBm'] as const,
        };
      case 'consumption-methods':
        return {
          delegate: asCatalog(this.prisma.consumptionMethodRef),
          fields: ['methodBilingual', 'patientInstructionBm'] as const,
          required: ['methodBilingual', 'patientInstructionBm'] as const,
        };
      case 'indications':
        return {
          delegate: asCatalog(this.prisma.indicationPreset),
          fields: ['labelEn', 'labelBm'] as const,
          required: ['labelEn', 'labelBm'] as const,
        };
      case 'stock-units':
        return {
          delegate: asCatalog(this.prisma.stockUnitRef),
          fields: ['name'] as const,
          required: ['name'] as const,
        };
    }
  }

  /**
   * Everything the clinic has, SYSTEM and CUSTOM together, ordered the way the
   * platform listed it.
   *
   * `includeRetired` exists for Settings, which has to show a retired row in
   * order to offer bringing it back. Every clinical surface asks for the
   * default — a retired frequency must not be offered on a new prescription.
   */
  list(catalog: ReferenceCatalogName, includeRetired = false) {
    const { delegate } = this.table(catalog);
    return delegate.findMany({
      where: { tenantId: currentTenantId(), ...(includeRetired ? {} : { active: true }) },
      orderBy: [{ origin: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /** A clinic's own entry. Always CUSTOM — origin is not client-settable. */
  async create(catalog: ReferenceCatalogName, body: Record<string, unknown>) {
    if (PLATFORM_ONLY.includes(catalog)) {
      throw new ForbiddenException(PLATFORM_ONLY_REFUSAL);
    }
    const { delegate, fields, required } = this.table(catalog);
    const data = this.pick(body, fields, required);
    return delegate.create({
      data: {
        ...data,
        tenantId: currentTenantId(),
        // Never from the body. A clinic that could post `origin: SYSTEM` could
        // make its own row un-editable by its own owner, and could shadow a
        // platform default the next seed run would then refuse to repair.
        origin: CatalogOrigin.CUSTOM,
        // After the platform's rows, in the order they were added.
        sortOrder: 1000,
      },
    });
  }

  async update(catalog: ReferenceCatalogName, id: string, body: Record<string, unknown>) {
    const row = await this.mustOwn(catalog, id);
    const { delegate, fields } = this.table(catalog);
    // No `required` on an update: a partial edit is legitimate. What is not
    // legitimate is emptying a field the row cannot do without, so a field
    // present in the body must carry a value.
    const data = this.pick(body, fields, []);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to change.');
    }
    return delegate.update({ where: { id: row.id }, data });
  }

  /** Retire, or bring back. Never a delete — the database refuses those. */
  async setActive(catalog: ReferenceCatalogName, id: string, active: boolean) {
    const row = await this.mustOwn(catalog, id);
    const { delegate } = this.table(catalog);
    return delegate.update({ where: { id: row.id }, data: { active } });
  }

  /**
   * The row exists, belongs to this clinic, and is the clinic's OWN.
   *
   * One place, so "SYSTEM rows are read-only" cannot be true of four
   * catalogues and forgotten in the fifth.
   */
  private async mustOwn(catalog: ReferenceCatalogName, id: string) {
    const { delegate } = this.table(catalog);
    const row = await delegate.findUnique({ where: { id } });
    // Tenant scope is enforced by RLS as well; this makes the 404 honest rather
    // than letting a cross-tenant id read as a server error.
    if (!row || row.tenantId !== currentTenantId()) {
      throw new NotFoundException('Entry not found');
    }
    if (row.origin === CatalogOrigin.SYSTEM) {
      throw new ForbiddenException(SYSTEM_ROW_REFUSAL);
    }
    return row;
  }

  /**
   * Copy only the fields this catalogue owns.
   *
   * An allow-list rather than a spread: the body is not permitted to reach
   * `origin`, `tenantId`, `sortOrder` or `active`, and a DTO per catalogue would
   * be five more places to forget one of them.
   */
  private pick(
    body: Record<string, unknown>,
    fields: readonly string[],
    required: readonly string[],
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const field of fields) {
      if (!(field in body)) continue;
      const value = body[field];
      // `timesPerDay: null` is MEANINGFUL — it is how PRN says "cannot be
      // counted" — so null is accepted for the nullable fields and only
      // blank strings are refused.
      if (typeof value === 'string' && value.trim() === '') {
        throw new BadRequestException(`${field} cannot be blank.`);
      }
      data[field] = typeof value === 'string' ? value.trim() : value;
    }
    for (const field of required) {
      if (data[field] === undefined || data[field] === null) {
        throw new BadRequestException(`${field} is required.`);
      }
    }
    return data;
  }
}
