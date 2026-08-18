import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { touchesStandardPrescription } from './dto/standard-prescription-defaults.dto';
import { itemSearchClauses } from './item-search';
import { CatalogueCounts, CatalogueRow, catalogueCounts, catalogueRow } from './item-catalogue';

/**
 * The catalogue page size. 20 matches what a search field can usefully show
 * before "refine your search" is the better answer; the maximum stops a
 * caller asking for everything.
 */
export const DEFAULT_CATALOGUE_TAKE = 20;
export const MAX_CATALOGUE_TAKE = 100;

@Injectable()
export class ItemService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async create(dto: CreateItemDto) {
    await this.assertStandardPrescriptionIsReal(dto);
    return this.prisma.item.create({
      data: { ...dto, tenantId: currentTenantId(), ...this.ownershipOf(dto) },
    });
  }

  /**
   * G4.5d5b-1 — BOUNDED, and searchable server-side.
   *
   * This returned the entire item catalogue, unbounded, and every medication
   * rail rendered all of it into a Select. A clinic with a few thousand items
   * therefore downloaded and rendered a few thousand options to let a doctor
   * pick one. The search term and the cap are the server's job: a browser
   * cannot filter a list it should never have been sent.
   *
   * `take` is capped rather than trusted, so a caller cannot ask for the whole
   * catalogue back by passing a large number.
   *
   * The bound applies to the SEARCH path only. The Inventory management page
   * legitimately lists the catalogue and is explicitly out of scope for this
   * checkpoint, so an unfiltered call behaves exactly as it did — silently
   * truncating that page to twenty items would be a worse defect than the one
   * being fixed.
   */
  findAll(activeOnly?: boolean, search?: string, take?: number) {
    const term = search?.trim();
    return this.prisma.item.findMany({
      where: {
        ...(activeOnly ? { active: true } : {}),
        ...(term ? { OR: itemSearchClauses(term) } : {}),
      },
      orderBy: { name: 'asc' },
      // b1 — the search box shows what is on the shelf, so the row it renders
      // has to come back with the row it is about. Fetching every stock level
      // separately to annotate twenty options is the same "download the whole
      // catalogue" mistake this method was written to fix, one table across.
      include: { stockLevels: { select: { clinicId: true, quantityOnHand: true, minThreshold: true } } },
      ...(term || take
        ? { take: Math.min(take ?? DEFAULT_CATALOGUE_TAKE, MAX_CATALOGUE_TAKE) }
        : {}),
    });
  }

  /**
   * THE INVENTORY MANAGEMENT LIST — the whole catalogue, shaped for the screen.
   *
   * Separate from `findAll`, which is the PRESCRIBING search: bounded, twenty
   * rows, no stock unit and no divisor. This one is the management page, which
   * legitimately lists everything and needs three things that search does not:
   * the packaging words in both languages, the effective divisor with its
   * provenance, and the pricing worklist's count.
   *
   * The count is computed over the UNFILTERED catalogue and returned beside
   * the filtered rows. That is the point of it: it answers "how much curation
   * is left at this clinic", and a number that shrank when somebody typed in
   * the search box would answer a question nobody asked.
   *
   * `attention` filtering happens here rather than in SQL, because the rule is
   * `divisorFacts` and there is going to be exactly one of those. A WHERE
   * clause encoding "coalesce(qps, upp) IS NULL OR (= 1 AND whole IS NULL)" is
   * the second implementation, and the first one to drift.
   */
  async catalogue(options: {
    search?: string;
    category?: string;
    attentionOnly?: boolean;
    activeOnly?: boolean;
    clinicId?: string;
  }): Promise<{ rows: CatalogueRow[]; counts: CatalogueCounts }> {
    const term = options.search?.trim();
    const items = await this.prisma.item.findMany({
      orderBy: { name: 'asc' },
      include: {
        stockUnit: { select: { id: true, name: true, nameMs: true, active: true } },
        stockLevels: { select: { clinicId: true, quantityOnHand: true, minThreshold: true } },
      },
    });

    const all = items.map((item) => catalogueRow(item, options.clinicId));
    const counts = catalogueCounts(all);

    // A second, id-only query rather than filtering the rows already in hand:
    // `itemSearchClauses` is the one definition of what a search matches (name,
    // code, and the clinic's own Malay group tag), and reimplementing it in
    // JavaScript to save a cheap round trip is how the two start disagreeing.
    const searchIds = term
      ? new Set(
          (
            await this.prisma.item.findMany({
              where: { OR: itemSearchClauses(term) },
              select: { id: true },
            })
          ).map((i) => i.id),
        )
      : null;

    const rows = all.filter((row) => {
      if (options.activeOnly && !row.active) return false;
      if (searchIds && !searchIds.has(row.id)) return false;
      if (options.category && (row.category ?? '').trim() !== options.category) return false;
      if (options.attentionOnly && row.attention === null) return false;
      return true;
    });

    return { rows, counts };
  }

  async findById(id: string) {
    // b1 — same shape as the search rows. The prescribing form shows price and
    // stock beside the locked drug name, and it should not need a second
    // request to say what the list it was picked from already said.
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: { stockLevels: { select: { clinicId: true, quantityOnHand: true, minThreshold: true } } },
    });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item;
  }

  async update(id: string, dto: UpdateItemDto) {
    await this.assertStandardPrescriptionIsReal(dto);
    return this.prisma.item.update({ where: { id }, data: { ...dto, ...this.ownershipOf(dto) } });
  }

  /**
   * PHASE 1G — once a person here edits the defaults, they are the clinic's.
   *
   * `seed:standard-rx` skips any row whose defaults it did not write, and it
   * decides that by this flag. Nothing cleared it before this, so the skip
   * branch was unreachable through the API and the next seed run would have
   * reverted a doctor's correction without a word. The flag is only ever
   * CLEARED here — set is the seeder's alone.
   *
   * Presence of the key is what counts, not the value: writing the same dose
   * back is still a person at the clinic saying "this one is right".
   */
  private ownershipOf(dto: object) {
    return touchesStandardPrescription(dto) ? { defaultsFromSeed: false } : {};
  }

  /**
   * The referenced frequency / unit / method exists, is this clinic's, and is
   * still in use.
   *
   * NOT redundant with the foreign keys. PostgreSQL runs FK checks through
   * internal triggers that are not subject to row-level security, so a
   * cross-tenant id passes the constraint and lands on the row — after which
   * every read of it is RLS-blocked and the doctor's form opens blank with no
   * explanation. Same reason a RETIRED row is refused: a prescribing form must
   * not open with a frequency the clinic has withdrawn.
   */
  private async assertStandardPrescriptionIsReal(dto: {
    defaultDoseUnitId?: string | null;
    defaultFrequencyId?: string | null;
    defaultConsumptionMethodId?: string | null;
  }) {
    const tenantId = currentTenantId();
    const checks: Array<[string, Promise<{ id: string } | null>]> = [];
    if (dto.defaultDoseUnitId) {
      checks.push([
        'Dose unit',
        this.prisma.dosageUnit.findFirst({
          where: { id: dto.defaultDoseUnitId, tenantId, active: true },
          select: { id: true },
        }),
      ]);
    }
    if (dto.defaultFrequencyId) {
      checks.push([
        'Frequency',
        this.prisma.prescriptionFrequency.findFirst({
          where: { id: dto.defaultFrequencyId, tenantId, active: true },
          select: { id: true },
        }),
      ]);
    }
    if (dto.defaultConsumptionMethodId) {
      checks.push([
        'Consumption method',
        this.prisma.consumptionMethodRef.findFirst({
          where: { id: dto.defaultConsumptionMethodId, tenantId, active: true },
          select: { id: true },
        }),
      ]);
    }
    if (checks.length === 0) return;

    const found = await Promise.all(checks.map(([, promise]) => promise));
    const missing = checks.filter((_, index) => found[index] === null).map(([label]) => label);
    if (missing.length > 0) {
      throw new BadRequestException(
        `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not on this clinic's list. Pick from the list, or add the entry in Settings › Prescription Vocabulary first.`,
      );
    }
  }
}
