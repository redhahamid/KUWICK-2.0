import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { currentTenantId } from '../core/tenant-context';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { type AdminTx, requirePermission, withAdminTx } from '../finance/admin-actor';
import { diffOf, recordAudit } from '../finance/admin-audit';
import { CreatePanelEmployerDto, UpdatePanelEmployerDto } from './dto/panel-employer.dto';

/**
 * THE EMPLOYERS BEHIND A PANEL (N-5; closes G-9).
 *
 * The owner asked for "a real list per panel, with quick-add at the counter"
 * rather than free text, and gave the reason: free text cannot answer "what did
 * we bill for Company X". The second reason is G-9 — one panel in the clinic's
 * workbook states its term as `VARY BASED ON COMPANY`, and until the company
 * was a row, no claim on that panel could be given a due date at all.
 *
 * WHY A LIST IS WORTH THE EXTRA WORK OVER FREE TEXT. "Contoh Sdn Bhd",
 * "CONTOH SDN. BHD." and "contoh sdn bhd" are one company and three strings.
 * As free text they are three rows in every report, three terms to configure,
 * and a per-employer due date that depends on how somebody typed it that
 * morning. So the name is compared case- and space-insensitively here before
 * anything is written, and the database holds a unique index per panel.
 *
 * DEACTIVATED, NEVER DELETED. A claim already raised references its employer,
 * and "who was this billed to" must keep an answer long after the clinic
 * stopped seeing that company.
 */
@Injectable()
export class PanelEmployerService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * The employers on a panel.
   *
   * Inactive ones are included only on request: the counter picker wants the
   * live list, and the configuration screen wants all of them, including the
   * company the clinic stopped seeing in March whose claims are still open.
   */
  async list(panelClinicId: string, includeInactive = false) {
    await requirePermission(this.rawPrisma, 'panel.view');
    const employers = await this.prisma.panelEmployer.findMany({
      where: { panelClinicId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
      include: { _count: { select: { visits: true } } },
    });
    return employers.map((employer) => ({
      id: employer.id,
      name: employer.name,
      code: employer.code,
      active: employer.active,
      paymentTermDays: employer.paymentTermDays,
      paymentTermMaxDays: employer.paymentTermMaxDays,
      paymentTermUnit: employer.paymentTermUnit,
      paymentTermAnchor: employer.paymentTermAnchor,
      /**
       * TRUE when this employer's own term governs its claims rather than the
       * panel's. Reported so a screen can say whose term a due date came from
       * instead of showing two dates weeks apart with no explanation.
       */
      hasOwnTerm: employer.paymentTermDays !== null,
      notes: employer.notes,
      visits: employer._count.visits,
    }));
  }

  async create(panelClinicId: string, dto: CreatePanelEmployerDto) {
    return withAdminTx(this.rawPrisma, 'panel.configure', async (tx, actor) => {
      const panel = await tx.panelClinic.findUnique({ where: { id: panelClinicId } });
      if (!panel) throw new NotFoundException('Panel not found');

      const name = dto.name.trim();
      await this.assertNameIsFree(tx, panelClinicId, name);
      assertTermMakesSense(dto);

      const employer = await tx.panelEmployer.create({
        data: {
          tenantId: currentTenantId(),
          panelClinicId,
          name,
          code: dto.code?.trim() || null,
          paymentTermDays: dto.paymentTermDays ?? null,
          paymentTermMaxDays: dto.paymentTermMaxDays ?? null,
          paymentTermUnit: dto.paymentTermUnit ?? null,
          paymentTermAnchor: dto.paymentTermAnchor ?? null,
          notes: dto.notes ?? null,
        },
      });

      await recordAudit(tx, actor, {
        action: 'panel.employerCreated',
        entityType: 'PanelEmployer',
        entityId: employer.id,
        after: {
          panel: panel.name,
          name: employer.name,
          code: employer.code,
          paymentTermDays: employer.paymentTermDays,
        },
        source: 'panel.employers',
      });

      return employer;
    });
  }

  async update(id: string, dto: UpdatePanelEmployerDto) {
    return withAdminTx(this.rawPrisma, 'panel.configure', async (tx, actor) => {
      const before = await tx.panelEmployer.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Employer not found');

      const name = dto.name?.trim();
      if (name && normalise(name) !== normalise(before.name)) {
        await this.assertNameIsFree(tx, before.panelClinicId, name, id);
      }
      assertTermMakesSense({ ...before, ...dto } as CreatePanelEmployerDto);

      const employer = await tx.panelEmployer.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}),
          ...(dto.paymentTermDays !== undefined ? { paymentTermDays: dto.paymentTermDays } : {}),
          ...(dto.paymentTermMaxDays !== undefined
            ? { paymentTermMaxDays: dto.paymentTermMaxDays }
            : {}),
          ...(dto.paymentTermUnit !== undefined ? { paymentTermUnit: dto.paymentTermUnit } : {}),
          ...(dto.paymentTermAnchor !== undefined
            ? { paymentTermAnchor: dto.paymentTermAnchor }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });

      /*
       * A TERM CHANGE MOVES DUE DATES ON CLAIMS NOBODY EDITED, so it is audited
       * as the financial act it is. It does NOT rewrite `ClaimBatchLine.dueDate`
       * on claims already submitted: that is a snapshot, stamped when the claim
       * went out, and the same reasoning that protects a sent claim's fee
       * treatment (D-112) protects its due date. A correction to the agreement
       * cannot reach back into a claim already being argued about.
       */
      const changed = diffOf(
        before as unknown as Record<string, unknown>,
        dto as unknown as Record<string, unknown>,
      );
      await recordAudit(tx, actor, {
        action: 'panel.employerUpdated',
        entityType: 'PanelEmployer',
        entityId: id,
        before: changed.before,
        after: changed.after,
        source: 'panel.employers',
      });

      return employer;
    });
  }

  /**
   * "Contoh Sdn Bhd" and "contoh  sdn  bhd" are one company. The database holds
   * a unique index on the exact name, which would let both in; this is what
   * stops them, and it is why the index is not the whole story.
   */
  private async assertNameIsFree(
    tx: AdminTx,
    panelClinicId: string,
    name: string,
    exceptId?: string,
  ) {
    // Compared in memory rather than with a case-insensitive query, because the
    // collision that matters is not only case: "contoh  sdn  bhd" differs from
    // "Contoh Sdn Bhd" by its inner spacing too, and no index catches that. A
    // panel has tens of employers, not thousands.
    const existing = await tx.panelEmployer.findMany({
      where: { panelClinicId },
      select: { id: true, name: true },
    });
    const clash = existing.find(
      (row) => row.id !== exceptId && normalise(row.name) === normalise(name),
    );
    if (clash) {
      throw new BadRequestException(
        `"${clash.name}" is already on this panel. Use that one, or rename it.`,
      );
    }
  }
}

/**
 * A range term whose far edge is nearer than its near edge is not a range, it
 * is two numbers in the wrong boxes — and it would silently produce a due date
 * EARLIER than the chase date, so the claim would read as overdue on the day it
 * was sent.
 */
function assertTermMakesSense(dto: {
  paymentTermDays?: number | null;
  paymentTermMaxDays?: number | null;
}) {
  const { paymentTermDays, paymentTermMaxDays } = dto;
  if (paymentTermMaxDays == null) return;
  if (paymentTermDays == null) {
    throw new BadRequestException(
      'A longest term needs a usual term beside it. Give the number of days this employer normally takes, or clear the longest.',
    );
  }
  if (paymentTermMaxDays < paymentTermDays) {
    throw new BadRequestException(
      `The longest term (${paymentTermMaxDays} days) cannot be shorter than the usual one (${paymentTermDays} days).`,
    );
  }
}

const normalise = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
