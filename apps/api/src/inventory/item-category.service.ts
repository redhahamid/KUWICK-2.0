import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';

/**
 * MANAGE CATEGORIES — add, rename, and a delete that is allowed to say no.
 *
 * `Item.category` is a string and stays the truth on the row. This service
 * owns the LIST of names, which is the part a string column cannot hold: a
 * section named before anything is filed in it, a rename that reaches every
 * item carrying the old word, and a delete that is refused while stock still
 * points at it.
 *
 * There is no cascade and no silent re-filing. Deleting a category that 40
 * items use would either orphan 40 rows or blank their category, and both are
 * a clinic losing the arrangement of their own shelf to a click.
 */
@Injectable()
export class ItemCategoryService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async list() {
    const [registry, items] = await Promise.all([
      this.prisma.itemCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.item.findMany({ select: { category: true } }),
    ]);
    return { registry, itemCategories: items.map((i) => i.category) };
  }

  async create(name: string) {
    const clean = this.clean(name);
    const existing = await this.prisma.itemCategory.findFirst({ where: { name: clean } });
    if (existing) {
      throw new ConflictException(`"${clean}" is already on the category list.`);
    }
    // Appended, not sorted in. A clinic that has arranged its sections keeps
    // that arrangement; a new one lands at the end where they can see it.
    const last = await this.prisma.itemCategory.findFirst({ orderBy: { sortOrder: 'desc' } });
    return this.prisma.itemCategory.create({
      data: { tenantId: currentTenantId(), name: clean, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
  }

  /**
   * A rename is TWO writes and they go together or not at all.
   *
   * The registry row and every item carrying the old string. Renaming only the
   * list would leave those items filed under a name no longer on it — they
   * would still show (the list unions in-use strings), so the clinic would see
   * the old category reappear beside the new one and conclude the rename
   * failed. It half did.
   */
  async rename(id: string, name: string) {
    const clean = this.clean(name);
    const category = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    if (category.name === clean) return category;

    const collision = await this.prisma.itemCategory.findFirst({ where: { name: clean } });
    if (collision) {
      throw new ConflictException(
        `"${clean}" is already on the category list. Merging two categories is not something this screen does — move the items across first.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const renamed = await tx.itemCategory.update({ where: { id }, data: { name: clean } });
      await tx.item.updateMany({ where: { category: category.name }, data: { category: clean } });
      return renamed;
    });
  }

  /**
   * Guarded when in use, and the refusal NAMES THE NUMBER.
   *
   * "Category in use" tells somebody to go looking. "23 items are filed under
   * ANTIBIOTIK" tells them what they are about to have to move, which is the
   * difference between a refusal and an obstruction.
   */
  async remove(id: string) {
    const category = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');

    const inUse = await this.prisma.item.count({ where: { category: category.name } });
    if (inUse > 0) {
      throw new ConflictException(
        `${inUse} ${inUse === 1 ? 'item is' : 'items are'} filed under "${category.name}". ` +
          'Move them to another category first — deleting this would leave them filed under a name that is no longer on the list.',
      );
    }

    await this.prisma.itemCategory.delete({ where: { id } });
    return { deleted: true, name: category.name };
  }

  /**
   * Adopt an in-use name into the registry.
   *
   * The import wrote category strings that nobody registered. They already
   * show as tabs; this is how they become renameable, which they are not while
   * they exist only as 41 copies of a word on 41 rows.
   */
  async adopt(name: string) {
    const clean = this.clean(name);
    const inUse = await this.prisma.item.count({ where: { category: clean } });
    if (inUse === 0) {
      throw new BadRequestException(`No items are filed under "${clean}". Use Add to create a new category.`);
    }
    return this.create(clean);
  }

  private clean(name: string) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('A category needs a name.');
    if (clean.length > 60) throw new BadRequestException('A category name is at most 60 characters.');
    return clean;
  }
}
