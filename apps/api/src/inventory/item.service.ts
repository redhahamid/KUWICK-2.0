import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

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

  create(dto: CreateItemDto) {
    return this.prisma.item.create({ data: { ...dto, tenantId: currentTenantId() } });
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
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { code: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      ...(term || take
        ? { take: Math.min(take ?? DEFAULT_CATALOGUE_TAKE, MAX_CATALOGUE_TAKE) }
        : {}),
    });
  }

  async findById(id: string) {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item;
  }

  update(id: string, dto: UpdateItemDto) {
    return this.prisma.item.update({ where: { id }, data: dto });
  }
}
