import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { SEED_PAY_COMPONENTS } from './pay-component-catalogue';
import { UpsertPayComponentDto } from './dto/upsert-pay-component.dto';

const EPOCH = new Date('1970-01-01T00:00:00.000Z');

/**
 * The attributes that decide what a component is LIABLE TO — everything the
 * calculation reads. A change to one of these is a change to the money and
 * gets a dated version; a change to the name or the active flag does not.
 */
const TREATMENT_FIELDS = [
  'type',
  'category',
  'includeIn',
  'pcbLiable',
  'epfLiable',
  'socsoLiable',
  'eisLiable',
  'hrdLiable',
  'includeInOrpBase',
  'includeInUnpaidLeaveBase',
  'additionalRemuneration',
  'pcbExemptionLimitCents',
  'prorated',
  'employerSide',
] as const;

/**
 * PAY COMPONENTS AS CONFIGURATION.
 *
 * The statutory treatment of a kind of money was a TypeScript constant, so a
 * clinic adding an allowance needed a deployment.
 *
 * WHAT THIS SERVICE REFUSES TO DO: assert that any flag is correct. Every
 * seeded row is `DRAFT`, which the statutory register reads as UNVERIFIED, and
 * `verificationStatus` can only be raised by `hr.statutory.manage` — and even
 * then this stage never raises it, because no authority has been read.
 */
@Injectable()
export class PayComponentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.payComponent.findMany({
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
    return {
      components: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        /** Settings says "Changed 2 Sep" per card; this is where that comes from. */
        updatedAt: row.updatedAt.toISOString(),
        type: row.type,
        category: row.category,
        includeIn: row.includeIn,
        pcbLiable: row.pcbLiable,
        epfLiable: row.epfLiable,
        socsoLiable: row.socsoLiable,
        eisLiable: row.eisLiable,
        hrdLiable: row.hrdLiable,
        includeInOrpBase: row.includeInOrpBase,
        includeInUnpaidLeaveBase: row.includeInUnpaidLeaveBase,
        additionalRemuneration: row.additionalRemuneration,
        pcbExemptionLimitCents: row.pcbExemptionLimitCents,
        eaField: row.eaField,
        prorated: row.prorated,
        employerSide: row.employerSide,
        systemControlled: row.systemControlled,
        active: row.active,
        verificationStatus: row.verificationStatus,
        version: row.version,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      })),
      /**
       * Said on the screen, not only in a document. Every flag above is a
       * clinic's configuration that no authority has confirmed.
       */
      verificationNotice: {
        anyVerified: rows.some((r) => r.verificationStatus === 'VERIFIED'),
        statement:
          'No statutory treatment on this page has been checked against KWSP, PERKESO, LHDN or HRD Corp. ' +
          'These flags reproduce what the payroll engine already did; they are not a statement of Malaysian law.',
      },
    };
  }

  /**
   * Seed the catalogue for a tenant that has none.
   *
   * Idempotent, and it never overwrites a row a clinic has already edited.
   */
  async seed() {
    return withAdminTx(this.rawPrisma, 'hr.statutory.manage', async (tx, actor) => {
      let created = 0;
      let existing = 0;
      for (const c of SEED_PAY_COMPONENTS) {
        const found = await tx.payComponent.findFirst({ where: { code: c.code } });
        if (found) {
          existing += 1;
          continue;
        }
        await tx.payComponent.create({
          data: {
            tenantId: currentTenantId(),
            code: c.code,
            name: c.name,
            type: c.type,
            category: c.category,
            includeIn: c.includeIn,
            pcbLiable: c.pcbLiable,
            epfLiable: c.epfLiable,
            socsoLiable: c.socsoLiable,
            eisLiable: c.eisLiable,
            hrdLiable: c.hrdLiable,
            includeInOrpBase: c.includeInOrpBase,
            includeInUnpaidLeaveBase: c.includeInUnpaidLeaveBase,
            additionalRemuneration: c.additionalRemuneration,
            prorated: c.prorated,
            employerSide: c.employerSide,
            systemControlled: true,
            // UNVERIFIED. Not a claim about the law.
            verificationStatus: 'DRAFT',
            sourceRef: 'Seeded to reproduce the existing engine behaviour. Not verified against any authority.',
            effectiveFrom: EPOCH,
            createdByStaffId: actor.id,
          },
        });
        created += 1;
      }
      if (created > 0) {
        await recordAudit(tx, actor, {
          action: 'payComponent.seeded',
          entityType: 'PayComponent',
          entityId: 'catalogue',
          reason: `Seeded ${created} pay component(s); ${existing} already present. All UNVERIFIED.`,
        });
      }
      return { created, existing, total: created + existing };
    });
  }

  async upsert(dto: UpsertPayComponentDto) {
    return withAdminTx(this.rawPrisma, 'hr.statutory.manage', async (tx, actor) => {
      const existing = dto.id ? await tx.payComponent.findFirst({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Pay component not found');

      // A preset may be enabled or disabled, never redefined. The audited
      // competitor makes the same choice and it is the right one: a clinic that
      // can silently retype the EPF liability of basic pay has a payroll nobody
      // can reason about.
      if (existing?.systemControlled) {
        const onlyToggling =
          dto.code === existing.code &&
          dto.name === existing.name &&
          dto.type === existing.type &&
          dto.category === existing.category;
        if (!onlyToggling) {
          throw new ConflictException(
            `"${existing.code}" is a system component. You may enable or disable it, but its statutory treatment is not editable here.`,
          );
        }
        const saved = await tx.payComponent.update({
          where: { id: existing.id },
          data: { active: dto.active ?? existing.active },
        });
        await recordAudit(tx, actor, {
          action: 'payComponent.updated',
          entityType: 'PayComponent',
          entityId: saved.id,
          reason: `${saved.active ? 'Enabled' : 'Disabled'} system pay component ${saved.code}`,
          before: { active: existing.active },
          after: { active: saved.active },
        });
        return saved;
      }

      if (dto.type === 'OVERTIME' && dto.includeInOrpBase) {
        throw new BadRequestException(
          'Overtime cannot enter the ordinary-rate base: an hour of overtime would raise the rate paid for the next one.',
        );
      }

      // The OPEN version of this code, which is what an edit is against. A
      // closed earlier version is history and never clashes.
      const open =
        existing ??
        (await tx.payComponent.findFirst({
          where: { code: dto.code, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        }));

      const data = {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        category: dto.category,
        includeIn: dto.includeIn ?? 'GROSS_AND_NET',
        pcbLiable: dto.pcbLiable ?? true,
        epfLiable: dto.epfLiable ?? false,
        socsoLiable: dto.socsoLiable ?? false,
        eisLiable: dto.eisLiable ?? false,
        hrdLiable: dto.hrdLiable ?? false,
        includeInOrpBase: dto.includeInOrpBase ?? false,
        includeInUnpaidLeaveBase: dto.includeInUnpaidLeaveBase ?? false,
        additionalRemuneration: dto.additionalRemuneration ?? false,
        pcbExemptionLimitCents: dto.pcbExemptionLimitCents ?? null,
        eaField: dto.eaField ?? null,
        prorated: dto.prorated ?? false,
        employerSide: dto.employerSide ?? false,
        active: dto.active ?? true,
        // A clinic-defined component is UNVERIFIED by construction.
        verificationStatus: 'DRAFT' as const,
      };

      /*
       * A TREATMENT CHANGE IS A NEW VERSION, NOT AN EDIT.
       *
       * `catalogueFor` resolves this table BY PERIOD, and this service
       * overwrote the row in place — so marking an allowance EPF-exempt today
       * changed what EVERY unapproved period computed, including months
       * already calculated and looked at. The same defect the salary and
       * statutory-classification tables were built to remove, in the third
       * place it could reach a payslip.
       *
       * A LABEL is still an edit. Correcting a component's name is not a
       * change to what it is liable to, and forcing a date onto it would make
       * a typo into a version.
       */
      const movedTreatment =
        open !== null &&
        TREATMENT_FIELDS.some(
          (field) => (data as Record<string, unknown>)[field] !== (open as unknown as Record<string, unknown>)[field],
        );

      if (open && movedTreatment) {
        if (!dto.effectiveFrom) {
          throw new BadRequestException(
            `The statutory treatment of "${dto.code}" is changing, and that is recorded from the date it takes ` +
              'effect. Send effectiveFrom: without it, this month and every earlier unapproved month would be ' +
              'recalculated under a rule that was not in force for them.',
          );
        }
        const from = new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
        if (from <= open.effectiveFrom) {
          throw new BadRequestException(
            `The current version of "${dto.code}" starts on ${open.effectiveFrom.toISOString().slice(0, 10)}, ` +
              `which is not before ${dto.effectiveFrom.slice(0, 10)}.`,
          );
        }
        const approvedCovering = await tx.payrollRun.count({
          where: {
            status: { in: ['APPROVED', 'PAID'] },
            period: { gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)) },
          },
        });
        if (approvedCovering > 0) {
          throw new ConflictException(
            `${approvedCovering} approved payroll run(s) cover this date or later. What was paid under the current ` +
              'treatment is settled; date the change from a period that has not been approved.',
          );
        }

        await tx.payComponent.update({
          where: { id: open.id },
          data: { effectiveTo: new Date(from.getTime() - 86_400_000) },
        });
        const saved = await tx.payComponent.create({
          data: {
            ...data,
            tenantId: currentTenantId(),
            systemControlled: open.systemControlled,
            version: open.version + 1,
            effectiveFrom: from,
            sourceRef: open.sourceRef,
            createdByStaffId: actor.id,
          },
        });
        await recordAudit(tx, actor, {
          action: 'payComponent.updated',
          entityType: 'PayComponent',
          entityId: saved.id,
          reason:
            dto.reason ??
            `New version ${saved.version} of pay component ${saved.code} from ${dto.effectiveFrom.slice(0, 10)} ` +
              '(statutory treatment UNVERIFIED)',
          before: open,
          after: saved,
        });
        return saved;
      }

      const saved = open
        ? await tx.payComponent.update({ where: { id: open.id }, data })
        : await tx.payComponent.create({
            data: {
              ...data,
              tenantId: currentTenantId(),
              systemControlled: false,
              effectiveFrom: dto.effectiveFrom
                ? new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`)
                : EPOCH,
              createdByStaffId: actor.id,
            },
          });

      await recordAudit(tx, actor, {
        action: open ? 'payComponent.updated' : 'payComponent.created',
        entityType: 'PayComponent',
        entityId: saved.id,
        reason: `${open ? 'Updated' : 'Created'} pay component ${saved.code} (statutory treatment UNVERIFIED)`,
        ...(open ? { before: open, after: saved } : { after: saved }),
      });

      return saved;
    });
  }
}
