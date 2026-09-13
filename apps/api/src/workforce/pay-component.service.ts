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
    /*
     * THE VERSION THAT STANDS — the open one — not every version there has
     * ever been, and NOT the one in force today.
     *
     * This table is append-per-change: a treatment change closes the old row
     * and writes a new one. The list had no filter at all, so the first
     * component a clinic re-dated appeared TWICE on the settings screen, once
     * as it is and once as it was, with nothing to say which was which.
     * Unreachable while presets were frozen; reachable by design now.
     *
     * Filtering to what is in force TODAY looks more correct and is worse: a
     * change dated from next month would not appear at all, so an owner who
     * had just made allowances EPF-exempt from 1 October would reopen the
     * screen, see EPF ✓, and conclude the product had thrown their decision
     * away. The open version is what the clinic has decided; `effectiveFrom`
     * on each row says when it starts, and the screen shows that date.
     *
     * `history()` holds the closed versions, which is where "what was an
     * allowance liable to in March" is answered.
     */
    const rows = await this.prisma.payComponent.findMany({
      where: { effectiveTo: null },
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
        effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
        /** Set by this clinic, rather than by the seed that reproduced the old engine. */
        clinicOverride: row.clinicOverride,
        changeReason: row.changeReason,
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
   * EVERY VERSION OF ONE COMPONENT, newest first.
   *
   * The settings screen shows what is in force. This answers the question an
   * audit actually asks — "what was an allowance liable to in March, and who
   * decided that?" — which the screen cannot, because March may be two
   * versions ago.
   *
   * Each row carries its own dates, its own flags, and its own provenance, so
   * a version set by the clinic is never presented as one Kuwick shipped.
   */
  async history(code: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.payComponent.findMany({
      where: { code },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (rows.length === 0) throw new NotFoundException(`No pay component with code "${code}"`);

    const actorIds = [...new Set(rows.map((r) => r.createdByStaffId).filter((id): id is string => id !== null))];
    const staff = actorIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
      : [];
    const nameOf = new Map(staff.map((person) => [person.id, person.fullName]));

    return {
      code,
      name: rows[0].name,
      versions: rows.map((row) => ({
        id: row.id,
        version: row.version,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
        pcbLiable: row.pcbLiable,
        epfLiable: row.epfLiable,
        socsoLiable: row.socsoLiable,
        eisLiable: row.eisLiable,
        hrdLiable: row.hrdLiable,
        includeInOrpBase: row.includeInOrpBase,
        includeInUnpaidLeaveBase: row.includeInUnpaidLeaveBase,
        additionalRemuneration: row.additionalRemuneration,
        prorated: row.prorated,
        /** Who set it, and why. Null on the seeded first version, which nobody chose. */
        clinicOverride: row.clinicOverride,
        changeReason: row.changeReason,
        sourceRef: row.sourceRef,
        verificationStatus: row.verificationStatus,
        setBy: row.createdByStaffId ? (nameOf.get(row.createdByStaffId) ?? null) : null,
        setAt: row.createdAt.toISOString(),
      })),
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

      // The OPEN version of this code, which is what an edit is against. A
      // closed earlier version is history and never clashes.
      const open =
        existing ??
        (await tx.payComponent.findFirst({
          where: { code: dto.code, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        }));

      /*
       * A PRESET'S IDENTITY IS FIXED. ITS STATUTORY TREATMENT IS THE CLINIC'S.
       *
       * This used to refuse both, on the grounds that "a clinic that can
       * silently retype the EPF liability of basic pay has a payroll nobody can
       * reason about". The load-bearing word there is SILENTLY, not never —
       * and refusing outright was wrong for a real reason:
       *
       *   Whether an allowance is EPF-liable is not a fact about Malaysia that
       *   Kuwick can ship. It is a POLICY the clinic sets, within what the law
       *   permits, and clinics differ. One contributes EPF on basic pay only;
       *   the next contributes on allowances too. A product that hardcodes
       *   either one is wrong at half its customers, and the seeded values are
       *   a starting guess reproducing the old engine — not a statement of law.
       *
       * So the four schemes, the bases and the tax attributes are editable, and
       * the refusal moves to what would actually break: WHAT THE COMPONENT IS.
       * `type` drives `kindOf` in the calculation and `category` drives the
       * year-end classification, so redefining `OVERTIME` as an ALLOWANCE does
       * not express a policy — it breaks the arithmetic that reads it.
       *
       * Nothing here is silent. The change needs a reason, it is dated, it
       * becomes a new version rather than an edit, and the version is marked as
       * the CLINIC's decision so a payslip's provenance never presents it as
       * Kuwick's.
       */
      if (existing?.systemControlled || open?.systemControlled) {
        const preset = existing ?? open!;
        const identityMoved =
          dto.code !== preset.code || dto.type !== preset.type || dto.category !== preset.category;
        if (identityMoved) {
          throw new ConflictException(
            `"${preset.code}" is a system component: what it IS cannot be redefined, because the calculation reads ` +
              'its type and the year-end forms read its category. Its statutory treatment — EPF, SOCSO, EIS, PCB ' +
              'and the bases — is yours to set.',
          );
        }
      }

      if (dto.type === 'OVERTIME' && dto.includeInOrpBase) {
        throw new BadRequestException(
          'Overtime cannot enter the ordinary-rate base: an hour of overtime would raise the rate paid for the next one.',
        );
      }

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
        /*
         * A REASON IS NOT OPTIONAL FOR A CHANGE TO THE MONEY.
         *
         * It used to be: `dto.reason` fell back to a generated sentence and the
         * row recorded nothing, so a year later the screen could show "EPF ✗ on
         * allowances" with no way to answer "why?" short of reading the audit
         * log — which the person defending the figure to KWSP does not have
         * open. The reason is stored ON the version it explains, because a
         * version is the unit that gets defended.
         *
         * Checked AFTER the date, because a date that would reprice a settled
         * month is the more urgent thing to be told about, and because both
         * errors were already established in that order.
         */
        if (!dto.reason || dto.reason.trim().length < 4) {
          throw new BadRequestException(
            `Changing the statutory treatment of "${dto.code}" changes what people are paid and what is remitted. ` +
              'Send a reason: it is kept with this version and shown beside the figures it produces.',
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
            /*
             * THE SEED'S PROVENANCE DOES NOT TRANSFER.
             *
             * Every seeded row says "Seeded to reproduce the existing engine
             * behaviour. Not verified against any authority." That is honest
             * about Kuwick's starting guess and a LIE about a clinic's own
             * policy. Carrying it onto this version would let a payslip cite
             * Kuwick as the source of a decision the clinic made.
             */
            sourceRef: null,
            clinicOverride: true,
            changeReason: dto.reason.trim(),
            createdByStaffId: actor.id,
          },
        });
        await recordAudit(tx, actor, {
          action: 'payComponent.updated',
          entityType: 'PayComponent',
          entityId: saved.id,
          reason: `${saved.code} v${saved.version} from ${dto.effectiveFrom.slice(0, 10)}, set by this clinic and UNVERIFIED: ${dto.reason.trim()}`,
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
