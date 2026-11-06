import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { currentTenantId } from '../core/tenant-context';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';

/**
 * WHAT THE COUNTER ALREADY KNOWS ABOUT A PATIENT'S PANEL (N-5).
 *
 * Kuwick 1.0 remembered the panel a patient came in on and 2.0 did not — a
 * regression nobody logged, and one that costs at the busiest moment of the
 * day: the card number, the employer and the relationship were keyed again at
 * every visit, from a card the patient has to find in their wallet.
 *
 * A SUGGESTION, NEVER A COMMITMENT. Everything here pre-fills a form. The visit
 * still starts PENDING_VERIFICATION, staff still press Verify, and the benefit
 * terms are still snapshotted onto the visit (D-092). A remembered panel that
 * has lapsed is caught by the same step that catches one typed wrongly by hand.
 *
 * IT REPORTS WHAT IT CANNOT OFFER. A remembered panel that has since been
 * deactivated is returned WITH `panelActive: false` rather than omitted, so the
 * counter can say "this patient was on Contoh TPA, which you have turned off"
 * instead of silently showing a blank form and letting somebody conclude the
 * patient was always self-pay.
 */
export const AUTO_SELECT_SETTING_KEY = 'panel.autoSelectLastPanel';

@Injectable()
export class PanelCounterService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * Whether the counter should pre-select a patient's last panel.
   *
   * DEFAULT ON, and the default is the behaviour Kuwick 1.0 had. A clinic that
   * wants the old 2.0 behaviour — pick the panel every time — turns it off.
   */
  private async autoSelectEnabled(): Promise<boolean> {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { tenantId_key: { tenantId: currentTenantId(), key: AUTO_SELECT_SETTING_KEY } },
      select: { value: true },
    });
    // Absent means nobody has chosen, which is the default, not "off".
    if (!setting) return true;
    return setting.value !== false;
  }

  async settings() {
    await requirePermission(this.rawPrisma, 'panel.view');
    return { autoSelectLastPanel: await this.autoSelectEnabled() };
  }

  async setAutoSelect(enabled: boolean) {
    return withAdminTx(this.rawPrisma, 'panel.configure', async (tx, actor) => {
      const before = await this.autoSelectEnabled();
      await tx.globalSetting.upsert({
        where: { tenantId_key: { tenantId: currentTenantId(), key: AUTO_SELECT_SETTING_KEY } },
        create: { tenantId: currentTenantId(), key: AUTO_SELECT_SETTING_KEY, value: enabled },
        update: { value: enabled },
      });
      await recordAudit(tx, actor, {
        action: 'globalSetting.changed',
        entityType: 'GlobalSetting',
        entityId: AUTO_SELECT_SETTING_KEY,
        before: { autoSelectLastPanel: before },
        after: { autoSelectLastPanel: enabled },
        source: 'panel.configuration',
      });
      return { autoSelectLastPanel: enabled };
    });
  }

  /**
   * The panel, employer, card number and relationship this patient last came
   * in on — plus whether the clinic wants them pre-selected at all.
   */
  async prefillFor(patientId: string) {
    await requirePermission(this.rawPrisma, 'panel.view');

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        lastPanelClinicId: true,
        lastPanelMemberReference: true,
        lastPanelRelationship: true,
        lastPanelClinic: { select: { id: true, name: true, active: true } },
        lastPanelEmployer: { select: { id: true, name: true, active: true, panelClinicId: true } },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const employer = patient.lastPanelEmployer;
    return {
      autoSelectLastPanel: await this.autoSelectEnabled(),
      /** NULL when this patient has never been registered on a panel. */
      panelClinicId: patient.lastPanelClinic?.id ?? null,
      panelName: patient.lastPanelClinic?.name ?? null,
      /** FALSE when the remembered panel has since been turned off. */
      panelActive: patient.lastPanelClinic?.active ?? null,
      /**
       * The employer is offered only while it still belongs to the remembered
       * panel. It cannot normally move, but a pre-fill that pairs an employer
       * with the wrong panel would be refused at visit creation — and the
       * person would be left staring at a form that looks right.
       */
      employerId:
        employer && employer.panelClinicId === patient.lastPanelClinicId ? employer.id : null,
      employerName:
        employer && employer.panelClinicId === patient.lastPanelClinicId ? employer.name : null,
      employerActive:
        employer && employer.panelClinicId === patient.lastPanelClinicId ? employer.active : null,
      memberReference: patient.lastPanelMemberReference,
      relationship: patient.lastPanelRelationship,
    };
  }
}
