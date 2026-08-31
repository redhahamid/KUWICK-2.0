import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NewItemRequestStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { findPossibleDuplicate } from './procurement-pricing';
import {
  ApproveNewItemRequestDto,
  RaiseNewItemRequestDto,
  RejectNewItemRequestDto,
} from './dto/new-item-request.dto';

/**
 * THE NEW-ITEM REQUEST WORKFLOW.
 *
 * The clinic asks for new medications on a five-column sheet — medication,
 * reason, comments, "stock admin noted", supplier — where the approval IS the
 * text in the fourth column (`docs/STOCK_LEGACY_WORKFLOW_AUDIT.md` §2). There
 * is no state, no actor, no date, and nothing checks whether the item already
 * exists, which is how a catalogue grows two entries for one medicine.
 *
 * Three properties this adds, and each replaces a specific failure:
 *
 *  1. **A DECISION HAS AN AUTHOR AND A DATE.** A text note in a cell cannot be
 *     asked who wrote it.
 *  2. **THE CATALOGUE IS CHECKED FIRST.** A near-match is surfaced at request
 *     time and again at approval, and creating past one takes a deliberate act.
 *     Two entries for one medicine means two stock levels, two costs, and a
 *     count that never reconciles.
 *  3. **AN APPROVED ITEM IS NOT YET USABLE.** It is created with
 *     `awaitingFirstReceipt`, inactive, and becomes real when stock physically
 *     arrives — which is what the clinic's own TO BE ACTIVATED MEDS sheet is
 *     for. Prescribing from something that has only been ordered hands a
 *     patient a script the dispensary cannot fill.
 */
@Injectable()
export class NewItemRequestService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list(params: { status?: NewItemRequestStatus } = {}) {
    await requirePermission(this.rawPrisma, 'stock.view');
    const requests = await this.prisma.newItemRequest.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        suggestedSupplier: { select: { name: true } },
        possibleDuplicate: { select: { id: true, name: true, code: true, active: true } },
        createdItem: { select: { id: true, name: true, active: true, awaitingFirstReceipt: true } },
        requestedBy: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
        clinic: { select: { name: true } },
      },
    });
    return requests.map((request) => ({
      id: request.id,
      requestedName: request.requestedName,
      reason: request.reason,
      comments: request.comments,
      clinicName: request.clinic?.name ?? null,
      suggestedSupplier: request.suggestedSupplier?.name ?? null,
      packSizeNote: request.packSizeNote,
      indicativeCost: request.indicativeCost === null ? null : Number(request.indicativeCost),
      indicativePrice: request.indicativePrice === null ? null : Number(request.indicativePrice),
      status: request.status,
      possibleDuplicate: request.possibleDuplicate
        ? {
            itemId: request.possibleDuplicate.id,
            name: request.possibleDuplicate.name,
            code: request.possibleDuplicate.code,
            active: request.possibleDuplicate.active,
          }
        : null,
      decisionNote: request.decisionNote,
      decidedBy: request.decidedBy?.fullName ?? null,
      decidedAt: request.decidedAt,
      createdItem: request.createdItem
        ? {
            itemId: request.createdItem.id,
            name: request.createdItem.name,
            active: request.createdItem.active,
            /** TRUE until the first delivery arrives — the item is not usable yet. */
            awaitingFirstReceipt: request.createdItem.awaitingFirstReceipt,
          }
        : null,
      requestedBy: request.requestedBy.fullName,
      createdAt: request.createdAt,
    }));
  }

  /**
   * Raise one. The duplicate check runs HERE as well as at approval, so the
   * requester sees the existing entry before a second one is ever asked for —
   * which is the cheapest possible moment to catch it.
   */
  async raise(dto: RaiseNewItemRequestDto) {
    return withAdminTx(this.rawPrisma, 'stock.view', async (tx, actor) => {
      const catalogue = await tx.item.findMany({ select: { id: true, name: true } });
      const duplicate = findPossibleDuplicate(dto.requestedName, catalogue);

      const request = await tx.newItemRequest.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId ?? null,
          requestedName: dto.requestedName.trim(),
          reason: dto.reason,
          comments: dto.comments ?? null,
          suggestedSupplierId: dto.suggestedSupplierId ?? null,
          packSizeNote: dto.packSizeNote ?? null,
          indicativeCost: dto.indicativeCost ?? null,
          indicativePrice: dto.indicativePrice ?? null,
          possibleDuplicateItemId: duplicate?.item.id ?? null,
          requestedByStaffId: actor.id,
        },
      });

      return {
        ...request,
        /** Shown immediately, so the requester can withdraw rather than wait. */
        possibleDuplicate: duplicate
          ? { itemId: duplicate.item.id, name: duplicate.item.name, similarity: duplicate.similarity }
          : null,
      };
    });
  }

  /** Approve it into existence: prose becomes a catalogue entry with fields. */
  async approve(id: string, dto: ApproveNewItemRequestDto) {
    return withAdminTx(this.rawPrisma, 'stock.price.manage', async (tx, actor) => {
      const request = await tx.newItemRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Request not found');
      if (request.status !== NewItemRequestStatus.PENDING) {
        throw new ConflictException(`This request was already ${request.status.toLowerCase()}.`);
      }

      const name = (dto.name ?? request.requestedName).trim();

      // Re-check at the moment of creation, not just at request time: the
      // catalogue may have gained the item in between, which is exactly how the
      // duplicate the clinic already has got there.
      const catalogue = await tx.item.findMany({ select: { id: true, name: true } });
      const duplicate = findPossibleDuplicate(name, catalogue);
      if (duplicate && !dto.acknowledgeDuplicate) {
        throw new ConflictException(
          `The catalogue already has "${duplicate.item.name}", which looks like the same medicine. ` +
            'Use that instead, or confirm you mean to create a second entry.',
        );
      }

      const item = await tx.item.create({
        data: {
          tenantId: currentTenantId(),
          name,
          code: dto.code ?? null,
          category: dto.category ?? null,
          unitOfMeasure: dto.unitOfMeasure ?? null,
          sellPrice: dto.sellPrice,
          cost: dto.cost ?? null,
          // NOT USABLE YET. The item exists in the catalogue and cannot be
          // prescribed or dispensed until stock physically arrives.
          active: false,
          awaitingFirstReceipt: true,
        },
      });

      // The opening price, recorded like every later one — so an item's cost
      // history starts at its first day rather than at the first time somebody
      // changed it.
      if (dto.cost !== undefined || dto.sellPrice !== undefined) {
        await tx.itemPriceChange.create({
          data: {
            tenantId: currentTenantId(),
            itemId: item.id,
            previousCost: null,
            newCost: dto.cost ?? null,
            previousSellPrice: null,
            newSellPrice: dto.sellPrice,
            source: 'NEW_ITEM_REQUEST',
            changedByStaffId: actor.id,
            note: `Opening price on approval of a new-item request for "${request.requestedName}".`,
          },
        });
      }

      const updated = await tx.newItemRequest.update({
        where: { id },
        data: {
          status: NewItemRequestStatus.APPROVED,
          decisionNote: dto.decisionNote ?? null,
          decidedByStaffId: actor.id,
          decidedAt: new Date(),
          createdItemId: item.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'stock.newItemApproved',
        entityType: 'NewItemRequest',
        entityId: id,
        before: { status: NewItemRequestStatus.PENDING, requestedName: request.requestedName },
        after: {
          status: NewItemRequestStatus.APPROVED,
          itemId: item.id,
          name,
          sellPrice: dto.sellPrice,
          cost: dto.cost ?? null,
          createdDespiteDuplicate: duplicate ? duplicate.item.name : null,
        },
        reason: dto.decisionNote,
        source: 'stock.newItemRequest',
      });

      return {
        ...updated,
        itemId: item.id,
        /** Said plainly, because an approved item that cannot be used surprises people. */
        note: `"${name}" is in the catalogue but is NOT usable yet. It becomes active when the first delivery is received.`,
      };
    });
  }

  async reject(id: string, dto: RejectNewItemRequestDto) {
    return withAdminTx(this.rawPrisma, 'stock.price.manage', async (tx, actor) => {
      const request = await tx.newItemRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Request not found');
      if (request.status !== NewItemRequestStatus.PENDING) {
        throw new ConflictException(`This request was already ${request.status.toLowerCase()}.`);
      }
      if (!dto.decisionNote?.trim()) {
        throw new BadRequestException('A rejection has to say why.');
      }

      const updated = await tx.newItemRequest.update({
        where: { id },
        data: {
          status: NewItemRequestStatus.REJECTED,
          decisionNote: dto.decisionNote,
          decidedByStaffId: actor.id,
          decidedAt: new Date(),
        },
      });

      await recordAudit(tx, actor, {
        action: 'stock.newItemRejected',
        entityType: 'NewItemRequest',
        entityId: id,
        before: { status: NewItemRequestStatus.PENDING },
        after: { status: NewItemRequestStatus.REJECTED },
        reason: dto.decisionNote,
        source: 'stock.newItemRequest',
      });

      return updated;
    });
  }

  /** An item's whole price history, newest first. Append-only at the database. */
  async priceHistory(itemId: string) {
    await requirePermission(this.rawPrisma, 'stock.view');
    const changes = await this.prisma.itemPriceChange.findMany({
      where: { itemId },
      orderBy: { changedAt: 'desc' },
      include: {
        changedBy: { select: { fullName: true } },
        goodsReceivedNote: { select: { id: true, receivedAt: true } },
      },
    });
    return changes.map((change) => ({
      id: change.id,
      changedAt: change.changedAt,
      previousCost: change.previousCost === null ? null : Number(change.previousCost),
      newCost: change.newCost === null ? null : Number(change.newCost),
      previousSellPrice: change.previousSellPrice === null ? null : Number(change.previousSellPrice),
      newSellPrice: change.newSellPrice === null ? null : Number(change.newSellPrice),
      source: change.source,
      note: change.note,
      changedBy: change.changedBy?.fullName ?? null,
      receivedAt: change.goodsReceivedNote?.receivedAt ?? null,
    }));
  }
}
