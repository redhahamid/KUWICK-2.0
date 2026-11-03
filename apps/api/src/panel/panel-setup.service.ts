import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PanelFeeTreatment, Prisma } from '@prisma/client';
import { currentTenantId } from '../core/tenant-context';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { SetupPanelsDto } from './dto/setup-panels.dto';

/**
 * SETTING UP THE PANEL MODULE WHEN IT IS EMPTY (N-2).
 *
 * A clinic with no panels lands on a blank claim workspace: a screen with
 * nothing on it and no indication that the first step is somewhere else. HR
 * solved this with `PayrollStartGate`; Panel had nothing.
 *
 * WHY A SEPARATE SERVICE rather than a loop over `PanelConfigService.update`.
 * That method exists to CHANGE a panel, and almost everything it does is about
 * change: it diffs against a previous state, it re-stamps unsent claims when
 * the fee direction moves, and it audits the difference. None of that applies
 * to a panel being created — there is no previous state and there are no
 * claims — and running it anyway would mean reading its re-stamp logic every
 * time somebody wondered what the wizard does to existing money. The answer is
 * nothing: this service only ever creates.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS WORTH THE FRICTION.
 *
 *   - A DUPLICATE NAME, inside the request or against a panel the clinic
 *     already has. The claim importer is idempotent on (panel, claim number),
 *     and a claim number means nothing without the panel that issued it — so
 *     two panels sharing a name is not cosmetic, it is two different answers
 *     to "whose claim is this". Compared case- and space-insensitively,
 *     because "PMCare" and "pmcare " are the same panel to everybody except a
 *     string comparison.
 *
 *   - A FEE VALUE ON A PANEL THAT CHARGES NOTHING. `NO_FEE` and a fee of RM8
 *     are the two halves of one term contradicting each other. Same check as
 *     the configuration screen's, for the same reason.
 *
 * ALL OR NOTHING. One transaction for every panel in the request. A wizard
 * that wrote nine of twelve panels and then failed would leave somebody
 * guessing which three to re-enter, and re-running it would then trip the
 * duplicate check on the nine that landed.
 */
@Injectable()
export class PanelSetupService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * WHETHER THIS CLINIC NEEDS SETTING UP, AND WHAT TO OFFER IT.
   *
   * `suggestions` is the platform's starter list minus the panels the clinic
   * already has, so re-opening the wizard after adding four panels offers the
   * remaining sixteen rather than all twenty with four that cannot be saved.
   */
  async status() {
    await requirePermission(this.rawPrisma, 'panel.view');

    const panels = await this.prisma.panelClinic.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, panelType: true, active: true, paymentTermDays: true, feeTreatment: true },
    });

    // Platform data: no tenant column, so it is read on the RAW client. There
    // is nothing tenant-specific to leak — it is the same list for everybody,
    // and it is what the platform console edits.
    const defaults = await this.rawPrisma.defaultPanelClinic.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { name: true, url: true, panelType: true },
    });

    const taken = new Set(panels.map((panel) => normalise(panel.name)));

    return {
      /**
       * TRUE when this clinic has no active panel at all. The one condition the
       * wizard opens on: a clinic that has deactivated every panel is as stuck
       * as one that never had any.
       */
      needsSetup: panels.filter((panel) => panel.active).length === 0,
      panels: panels.map((panel) => ({
        id: panel.id,
        name: panel.name,
        panelType: panel.panelType,
        active: panel.active,
        /** Shown so the wizard can say what is still unanswered rather than
            implying a panel is finished because it exists. */
        hasTerm: panel.paymentTermDays !== null,
        feeSettled: panel.feeTreatment !== PanelFeeTreatment.UNCONFIGURED,
      })),
      suggestions: defaults
        .filter((row) => !taken.has(normalise(row.name)))
        .map((row) => ({ name: row.name, portalUrl: row.url, panelType: row.panelType })),
    };
  }

  async createMany(dto: SetupPanelsDto) {
    return withAdminTx(this.rawPrisma, 'panel.configure', async (tx, actor) => {
      const tenantId = currentTenantId();

      // --- Refuse before writing anything --------------------------------
      const seen = new Map<string, string>();
      for (const row of dto.panels) {
        const key = normalise(row.name);
        if (!key) throw new BadRequestException('A panel needs a name.');
        const already = seen.get(key);
        if (already) {
          throw new BadRequestException(
            `"${row.name}" and "${already}" are the same panel. Each panel can only be listed once.`,
          );
        }
        seen.set(key, row.name);

        if (
          row.feeTreatment === PanelFeeTreatment.NO_FEE &&
          row.claimFeeValue !== undefined &&
          row.claimFeeValue > 0
        ) {
          throw new BadRequestException(
            `"${row.name}" is set to charge no fee, but carries a fee of ${row.claimFeeValue}. Clear the fee, or say how the fee is treated.`,
          );
        }
      }

      const existing = await tx.panelClinic.findMany({ select: { name: true } });
      const taken = new Map(existing.map((panel) => [normalise(panel.name), panel.name]));
      const clashes = dto.panels
        .filter((row) => taken.has(normalise(row.name)))
        .map((row) => taken.get(normalise(row.name)));
      if (clashes.length > 0) {
        throw new BadRequestException(
          `Already set up: ${clashes.join(', ')}. Remove them from the list, or edit them in Panel configuration.`,
        );
      }

      // --- Write ----------------------------------------------------------
      // Day precision, and the same instant for every panel in the run, so one
      // wizard pass reads as one act in the fee history rather than as a
      // scatter of terms a few milliseconds apart.
      const effectiveFrom = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      const created: { id: string; name: string }[] = [];

      for (const row of dto.panels) {
        const treatment = row.feeTreatment ?? PanelFeeTreatment.UNCONFIGURED;
        const feeValue = row.claimFeeValue === undefined ? null : new Prisma.Decimal(row.claimFeeValue);

        const panel = await tx.panelClinic.create({
          data: {
            tenantId,
            name: row.name.trim(),
            panelType: row.panelType ?? null,
            portalUrl: row.portalUrl ?? null,
            paymentTermDays: row.paymentTermDays ?? null,
            paymentTermUnit: row.paymentTermUnit ?? null,
            paymentTermAnchor: row.paymentTermAnchor ?? null,
            feeTreatment: treatment,
            claimFeeType: row.claimFeeType ?? null,
            claimFeeValue: feeValue,
          },
        });

        /*
         * AN OPENING FEE TERM, EVEN WHEN THE ANSWER IS "NOBODY KNOWS".
         *
         * `PanelClinic.feeTreatment` is a MIRROR of the effective-dated history
         * (D-112), and a mirror with nothing behind it is the one state that
         * convention cannot survive: the next edit on the configuration screen
         * would write the panel's first term dated today, and a claim raised
         * before that would fall before the history starts. So every panel gets
         * a term from the day it was created — `UNCONFIGURED` is a recorded
         * fact, not an absence.
         */
        await tx.panelFeeTerm.create({
          data: {
            tenantId,
            panelClinicId: panel.id,
            effectiveFrom,
            feeTreatment: treatment,
            feeType: row.claimFeeType ?? null,
            feeValue,
            note: 'Opening term, recorded when the panel was set up.',
            recordedByStaffId: actor.id,
          },
        });

        await recordAudit(tx, actor, {
          action: 'panel.created',
          entityType: 'PanelClinic',
          entityId: panel.id,
          after: {
            name: panel.name,
            panelType: panel.panelType,
            paymentTermDays: panel.paymentTermDays,
            feeTreatment: treatment,
            claimFeeType: row.claimFeeType ?? null,
            claimFeeValue: row.claimFeeValue ?? null,
          },
          source: 'panel.setup',
        });

        created.push({ id: panel.id, name: panel.name });
      }

      return {
        created,
        /** What the clinic still has to answer, so the wizard can say so
            instead of finishing on "done" when two panels have no term. */
        withoutTerm: dto.panels.filter((row) => row.paymentTermDays === undefined).length,
        feeUnsettled: dto.panels.filter(
          (row) => (row.feeTreatment ?? PanelFeeTreatment.UNCONFIGURED) === PanelFeeTreatment.UNCONFIGURED,
        ).length,
      };
    });
  }
}

/** "PMCare", "pmcare " and "PM  Care" are not three panels. */
const normalise = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
