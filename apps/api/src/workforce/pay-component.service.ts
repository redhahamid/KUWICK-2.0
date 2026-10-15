import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { defaultEaBox } from './ea-form';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { ActingStaff } from '../clinical/clinical-actor';
import { AdminTx } from '../finance/admin-actor';
import { PayComponent } from '@prisma/client';
import { SEED_PAY_COMPONENTS } from './pay-component-catalogue';
import { UpsertPayComponentDto } from './dto/upsert-pay-component.dto';
import { SetPayDateDto } from './dto/set-pay-date.dto';
import { DEFAULT_PAY_DATE, describePayDate } from './pay-dates';
import { DERIVED_CODES } from './payroll-register-columns';

const EPOCH = new Date('1970-01-01T00:00:00.000Z');

/**
 * WHETHER A STANDARD ITEM IS ALREADY HERE: by its code, or by its name when
 * the clinic made it by hand under a code of its own. A clinic that typed
 * "Housecall" as HOUSE_CALL before the preset existed is not offered a
 * second Housecall.
 */
function alreadyHere(preset: { code: string; name: string }, rows: readonly { code: string; name: string }[]): boolean {
  // Letters and digits only: a clinic's own "Housecall" is the preset "House call".
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = plain(preset.name);
  return rows.some((row) => row.code === preset.code || plain(row.name) === name);
}

/**
 * The attributes that decide what a component is LIABLE TO — everything the
 * calculation reads. A change to one of these is a change to the money and
 * gets a dated version; a change to the name or the active flag does not.
 */
/** Items the run works out or supplies itself: never a grid column, never carried forward. */

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
/*
 * A TREATMENT DATED EARLIER THAN THE VERSION IN FORCE (UAT, 11 October 2026):
 * "Turning SOCSO off for ALLOWANCE from Jan 2026 is refused." The rule built
 * for HRD registration: a version's start may be corrected, or a change dated
 * earlier, as long as no APPROVED or PAID month of ANY branch lies in the
 * period that would be priced differently. Payroll items are tenant-wide, so
 * the check is too. Every row touched is logged with who, when and why.
 */
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayBefore = (date: Date) => new Date(date.getTime() - 86_400_000);
const monthOf = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

/** Refuses, naming the months and branches, when a settled month lies in [from's month, until). */
async function refuseOverApproved(tx: AdminTx, code: string, from: Date, until: Date | null) {
  const runs = await tx.payrollRun.findMany({
    where: { status: { in: ['APPROVED', 'PAID'] }, period: { gte: monthOf(from), ...(until ? { lt: until } : {}) } },
    select: { period: true, clinic: { select: { name: true } } },
    orderBy: { period: 'asc' },
  });
  if (runs.length === 0) return;
  const named = [
    ...new Set(
      runs.map(
        (run) =>
          `${run.period.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })} (${run.clinic?.name ?? 'all branches'})`,
      ),
    ),
  ];
  throw new ConflictException(
    `${named.join(', ')} ${named.length === 1 ? 'is' : 'are'} approved, and ${code} would be priced differently there. ` +
      'Nothing was changed. Date the change after the last approved month, or correct that month with an adjustment.',
  );
}

/** The version in force started earlier than recorded, with the same treatment: its start moves back. */
async function correctStart(tx: AdminTx, actor: ActingStaff, open: PayComponent, from: Date, reason: string) {
  const versions = await tx.payComponent.findMany({ where: { code: open.code }, orderBy: { effectiveFrom: 'asc' } });
  const inside = versions.find((row) => row.id !== open.id && row.effectiveFrom >= from && row.effectiveFrom < open.effectiveFrom);
  if (inside) {
    throw new BadRequestException(
      `Version ${inside.version} of ${open.code} starts on ${isoDay(inside.effectiveFrom)}, inside that period. ` +
        `Choose a date after ${isoDay(inside.effectiveFrom)}, or change that version's treatment instead.`,
    );
  }
  await refuseOverApproved(tx, open.code, from, open.effectiveFrom);
  const governing = [...versions].reverse().find((row) => row.effectiveFrom < from) ?? null;
  if (governing) await tx.payComponent.update({ where: { id: governing.id }, data: { effectiveTo: dayBefore(from) } });
  const saved = await tx.payComponent.update({ where: { id: open.id }, data: { effectiveFrom: from, changeReason: reason } });
  await recordAudit(tx, actor, {
    action: 'payComponent.startCorrected',
    entityType: 'PayComponent',
    entityId: saved.id,
    reason: `Corrected the start of ${open.code} v${open.version} from ${isoDay(open.effectiveFrom)} to ${isoDay(from)}: ${reason}`,
    before: { effectiveFrom: isoDay(open.effectiveFrom), previousEndsOn: governing?.effectiveTo ? isoDay(governing.effectiveTo) : null },
    after: { effectiveFrom: isoDay(from), previousEndsOn: governing ? isoDay(dayBefore(from)) : null },
  });
  return saved;
}

/**
 * A treatment change dated before the version in force: from that date on,
 * every version says it. The version covering the date is split there (a
 * new version from the date), and each later version takes the same change.
 */
async function changeFromEarlier(
  tx: AdminTx,
  actor: ActingStaff,
  open: PayComponent,
  changed: Record<string, unknown>,
  from: Date,
  reason: string,
) {
  await refuseOverApproved(tx, open.code, from, null);
  const versions = await tx.payComponent.findMany({ where: { code: open.code }, orderBy: { effectiveFrom: 'asc' } });
  const later = versions.filter((row) => row.effectiveFrom >= from);
  const governing = [...versions].reverse().find((row) => row.effectiveFrom < from) ?? null;
  const fields = Object.entries(changed).map(([field, value]) => `${field} ${String(value)}`).join(', ');
  if (governing) {
    await tx.payComponent.update({ where: { id: governing.id }, data: { effectiveTo: dayBefore(from) } });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, createdAt, updatedAt, ...kept } = governing;
    const inserted = await tx.payComponent.create({
      data: {
        ...kept,
        ...changed,
        version: Math.max(...versions.map((row) => row.version)) + 1,
        effectiveFrom: from,
        effectiveTo: later[0] ? dayBefore(later[0].effectiveFrom) : null,
        sourceRef: null,
        clinicOverride: true,
        changeReason: reason,
        createdByStaffId: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: 'payComponent.updated',
      entityType: 'PayComponent',
      entityId: inserted.id,
      reason:
        `${open.code} v${inserted.version} inserted from ${isoDay(from)}` +
        `${inserted.effectiveTo ? ` to ${isoDay(inserted.effectiveTo)}` : ''} (${fields}), set by this clinic and UNVERIFIED: ${reason}`,
      before: governing,
      after: inserted,
    });
  }
  let saved = open;
  for (const row of later) {
    const updated = await tx.payComponent.update({ where: { id: row.id }, data: { ...changed, clinicOverride: true } });
    await recordAudit(tx, actor, {
      action: 'payComponent.updated',
      entityType: 'PayComponent',
      entityId: row.id,
      reason: `${open.code} v${row.version} (from ${isoDay(row.effectiveFrom)}) takes the change dated ${isoDay(from)} (${fields}): ${reason}`,
      before: row,
      after: updated,
    });
    if (row.id === open.id) saved = updated;
  }
  return saved;
}

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
    // The people named on the items, by name: a list of ids is no use to the
    // person deciding who a director's fee is for, and a leaver stays named
    // until somebody takes them off.
    const namedIds = [...new Set(rows.flatMap((row) => row.appliesToStaffIds))];
    const named = namedIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: namedIds } }, select: { id: true, fullName: true, active: true } })
      : [];
    const nameOf = new Map(named.map((person) => [person.id, person]));
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
        /** The box the EA form uses when the item names none. */
        eaBoxDefault: defaultEaBox(row),
        prorated: row.prorated,
        employerSide: row.employerSide,
        gridColumn: row.gridColumn,
        carryForward: row.carryForward,
        /** The default day of the run's month it is paid on. */
        payDay: row.payDay,
        /** Paid in the run after the month it was earned in: September's in the October run. */
        paidInArrears: row.payMonthOffset === 1,
        /** The date falls in the month after the run's: salary on the 1st of the following month. */
        paidFollowingMonth: row.payDateMonthOffset === 1,
        /** Who the item is for: everybody, or the employees named below. */
        appliesTo: row.appliesTo,
        appliesToStaffIds: row.appliesToStaffIds,
        appliesToStaff: row.appliesToStaffIds.map((id) => ({
          staffId: id,
          fullName: nameOf.get(id)?.fullName ?? 'Former employee',
          active: nameOf.get(id)?.active ?? false,
        })),
        /** A person keys this item, so it can be for named people; the derived ones are for whoever the records say. */
        audienceEditable: !DERIVED_CODES.has(row.code) && row.type !== 'OVERTIME',
        /** A person keys this item's amount, so it may have its own column and carry forward. */
        handKeyed: row.type === 'ADDITION' && !DERIVED_CODES.has(row.code),
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
      /*
       * PRESETS KUWICK HAS ADDED SINCE THIS CLINIC SEEDED, IF ANY.
       *
       * The seed is additive — it skips a code that exists and creates one
       * that does not — but the button that runs it was drawn only on an EMPTY
       * catalogue, so a clinic that seeded once could never receive a component
       * added later. It would be described in a release note, absent from the
       * screen, and the run that wanted it would point at a component nobody
       * could find.
       *
       * Named rather than counted, because "one item is missing" invites the
       * question this answers.
       */
      missingPresets: SEED_PAY_COMPONENTS.filter((preset) => !preset.addOn && !alreadyHere(preset, rows)).map((preset) => ({
        code: preset.code,
        name: preset.name,
      })),
      /** Optional items one clinic uses and most do not, offered one at a time. */
      addOns: SEED_PAY_COMPONENTS.filter((preset) => preset.addOn && !alreadyHere(preset, rows)).map((preset) => ({
        code: preset.code,
        name: preset.name,
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
  /**
   * Adds Kuwick's preset items the clinic does not have yet. `baseOnly` (the
   * "Add the standard items" button) leaves the optional add-ons out; `codes`
   * adds just those. With neither, every preset, as before.
   */
  async seed(options: { baseOnly?: boolean; codes?: string[] } = {}) {
    return withAdminTx(this.rawPrisma, 'hr.statutory.manage', async (tx, actor) => {
      let created = 0;
      let existing = 0;
      const held = await tx.payComponent.findMany({ select: { code: true, name: true } });
      const wanted = SEED_PAY_COMPONENTS.filter((c) =>
        options.codes?.length ? options.codes.includes(c.code) : !(options.baseOnly && c.addOn),
      );
      for (const c of wanted) {
        if (alreadyHere(c, held)) {
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
            ...(c.payDay ? { payDay: c.payDay } : {}),
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

  /**
   * WHEN AN ITEM IS PAID, written on every version of it: the default day
   * of the run's month, and whether the run pays what was earned the month
   * before.
   *
   * Payment, not treatment: what the item is liable to does not move, so this
   * writes no version and asks for no reason, like the item's own column. It
   * goes on every version so that whichever version a month resolves to says
   * the same; an approved month keeps what it was approved with, because the
   * approved record froze it. A run never pays a month's work twice whichever
   * way arrears is switched: overtime another month's run already carries is
   * left out. A deduction comes out of the salary payment, so it has no date
   * of its own; basic pay is the month's own salary, so never in arrears.
   */
  async setPayDate(code: string, dto: SetPayDateDto) {
    return withAdminTx(this.rawPrisma, 'hr.statutory.manage', async (tx, actor) => {
      const versions = await tx.payComponent.findMany({ where: { code }, orderBy: { effectiveFrom: 'asc' } });
      if (versions.length === 0) throw new NotFoundException('Pay component not found');
      const open = versions.find((row) => row.effectiveTo === null) ?? versions[versions.length - 1];
      if (open.type === 'DEDUCTION') {
        throw new BadRequestException(
          `${open.name} is a deduction. It comes out of the salary payment, so it has no pay date of its own.`,
        );
      }
      const paidInArrears = dto.paidInArrears ?? open.payMonthOffset === 1;
      if (paidInArrears && open.code === 'BASIC') {
        throw new BadRequestException('Basic pay is the month’s own salary, so it is never paid a month in arrears.');
      }
      const paidFollowingMonth = dto.paidFollowingMonth ?? open.payDateMonthOffset === 1;
      await tx.payComponent.updateMany({
        where: { code },
        data: { payDay: dto.payDay, payMonthOffset: paidInArrears ? 1 : 0, payDateMonthOffset: paidFollowingMonth ? 1 : 0 },
      });
      await recordAudit(tx, actor, {
        action: 'payComponent.payDateSet',
        entityType: 'PayComponent',
        entityId: open.id,
        before: { payDay: open.payDay, paidInArrears: open.payMonthOffset === 1, paidFollowingMonth: open.payDateMonthOffset === 1 },
        after: { payDay: dto.payDay, paidInArrears, paidFollowingMonth },
        reason: `${open.code} is paid on the ${describePayDate({ payDay: dto.payDay, monthOffset: paidFollowingMonth ? 1 : 0 }, paidInArrears)}.`,
      });
      return { code, payDay: dto.payDay, paidInArrears, paidFollowingMonth };
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
              'its type, and its category is kept for the year-end forms. ' +
              'Its statutory treatment — EPF, SOCSO, EIS, PCB and the bases — is yours to set.',
          );
        }
      }

      if (dto.type === 'OVERTIME' && dto.includeInOrpBase) {
        throw new BadRequestException(
          'Overtime cannot enter the ordinary-rate base: an hour of overtime would raise the rate paid for the next one.',
        );
      }

      /*
       * OWN COLUMN AND CARRY FORWARD ARE FOR HAND-KEYED ITEMS ONLY.
       *
       * Basic pay is the salary record, overtime and unpaid leave come from
       * the records, a reimbursement from an approved claim, a leave payout
       * from the leaver's balance and PCB is supplied against its own column.
       * A column of those would be either a duplicate or a lie, and carrying
       * one forward would pay last month's overtime again.
       */
      if (dto.gridColumn || dto.carryForward) {
        if (DERIVED_CODES.has(dto.code) || dto.type === 'OVERTIME') {
          throw new BadRequestException(
            `${dto.name} is worked out from the records or supplied against its own column, so it cannot have its own ` +
              'grid column or carry forward. Those are for items a person keys by hand.',
          );
        }
        if (dto.gridColumn && dto.type === 'DEDUCTION') {
          throw new BadRequestException(
            'Only an addition can have its own column on the grid for now. A deduction stays in the Other deductions cell and the drawer.',
          );
        }
      }

      /*
       * WHO THE ITEM IS FOR. Everybody unless the clinic names its people, and
       * then those people alone — so the grid, the drawer and the month start
       * all read one list. An item the run works out has no list: it applies
       * to whoever the records say.
       */
      const appliesTo = dto.appliesTo ?? 'EVERYONE';
      const appliesToStaffIds = appliesTo === 'SELECTED' ? [...new Set(dto.appliesToStaffIds ?? [])] : [];
      if (appliesTo === 'SELECTED') {
        if (DERIVED_CODES.has(dto.code) || dto.type === 'OVERTIME') {
          throw new BadRequestException(
            `${dto.name} is worked out from the records, so it has no list of people: it applies to whoever the records say.`,
          );
        }
        if (appliesToStaffIds.length === 0) {
          throw new BadRequestException(`Pick at least one employee ${dto.name} is for, or choose Everyone.`);
        }
        const known = await tx.staff.findMany({ where: { id: { in: appliesToStaffIds } }, select: { id: true } });
        if (known.length !== appliesToStaffIds.length) {
          throw new BadRequestException('One of the employees picked is not on this clinic’s staff list.');
        }
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
        gridColumn: dto.gridColumn ?? false,
        carryForward: dto.carryForward ?? false,
        // WHEN IT IS PAID rides along unless named: a treatment change writes a
        // new version, and that version must not quietly move the item back to
        // the 30th.
        payDay: dto.payDay ?? open?.payDay ?? DEFAULT_PAY_DATE.payDay,
        payMonthOffset: dto.paidInArrears === undefined ? (open?.payMonthOffset ?? 0) : dto.paidInArrears ? 1 : 0,
        payDateMonthOffset: dto.paidFollowingMonth === undefined ? (open?.payDateMonthOffset ?? 0) : dto.paidFollowingMonth ? 1 : 0,
        appliesTo,
        appliesToStaffIds,
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

      /*
       * A VERSION THAT HAS NOT STARTED IS NOT HISTORY — IT IS A PLAN.
       *
       * An owner mis-tapped EPF on overtime, saved it from 1 October, and then
       * could not undo it: dating the correction from the same 1 October was
       * refused as "not before", so the only way out was a THIRD version from
       * November — leaving a month of a treatment nobody wanted, recorded as
       * though it had been decided.
       *
       * The rule that produced that is right about the past and wrong about
       * the future. What makes a version immovable is that money was paid
       * under it, and nothing is paid under a version that has not begun. So
       * while a version has not started, editing it EDITS THAT VERSION rather
       * than stacking another on top.
       *
       * The approved-run guard below is untouched and still decides: any date
       * a settled month covers is refused whichever path this takes.
       *
       * `pay_components` carries no append-only trigger, unlike `appointments`
       * — checked, not assumed. An appointment is a medicolegal record of
       * something that happened; a configuration version that never took
       * effect is a record of nothing, and the audit log keeps the mis-tap.
       */
      const todayUtc = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      const notYetStarted = open !== null && open.effectiveFrom > todayUtc;

      if (open && movedTreatment) {
        if (!dto.effectiveFrom && !notYetStarted) {
          throw new BadRequestException(
            `The statutory treatment of "${dto.code}" is changing, and that is recorded from the date it takes ` +
              'effect. Send effectiveFrom: without it, this month and every earlier unapproved month would be ' +
              'recalculated under a rule that was not in force for them.',
          );
        }
        // Correcting a version that has not started keeps its own date unless a
        // new one is named.
        const from = dto.effectiveFrom
          ? new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`)
          : open.effectiveFrom;
        if (!notYetStarted && from < open.effectiveFrom) {
          if (!dto.reason || dto.reason.trim().length < 4) {
            throw new BadRequestException(
              `Changing the statutory treatment of "${dto.code}" from an earlier date changes what people are paid. ` +
                'Send a reason: it is kept with the change.',
            );
          }
          const changed = Object.fromEntries(
            TREATMENT_FIELDS.filter(
              (field) => (data as Record<string, unknown>)[field] !== (open as unknown as Record<string, unknown>)[field],
            ).map((field) => [field, (data as Record<string, unknown>)[field]]),
          );
          return changeFromEarlier(tx, actor, open, changed, from, dto.reason.trim());
        }
        if (!notYetStarted && from <= open.effectiveFrom) {
          throw new BadRequestException(
            `The current version of "${dto.code}" starts on ${open.effectiveFrom.toISOString().slice(0, 10)}, ` +
              `which is not before ${dto.effectiveFrom?.slice(0, 10)}.`,
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

        if (notYetStarted) {
          /*
           * CORRECTING A PLAN, not writing history.
           *
           * The version has not begun, so there is nothing to preserve and
           * nothing to date around: it is edited where it stands, keeping its
           * version number, because it was never in force to be superseded.
           */
          const previous = await tx.payComponent.findFirst({
            where: { code: dto.code, effectiveTo: { not: null } },
            orderBy: { effectiveFrom: 'desc' },
          });
          const backToPrevious =
            previous !== null &&
            TREATMENT_FIELDS.every(
              (field) =>
                (data as Record<string, unknown>)[field] === (previous as unknown as Record<string, unknown>)[field],
            );

          if (backToPrevious) {
            /*
             * A VERSION THAT SAYS WHAT THE ONE BEFORE IT SAYS IS NOT A VERSION.
             *
             * Undoing a mis-tap must leave the catalogue as though the tap had
             * not happened — not a second row recording that the clinic decided
             * the same thing twice, which is what an owner would have to
             * explain to an auditor who asked why. The withdrawal itself is in
             * the audit log, where a mistake belongs.
             */
            await tx.payComponent.delete({ where: { id: open.id } });
            const restored = await tx.payComponent.update({
              where: { id: previous.id },
              data: { effectiveTo: null },
            });
            await recordAudit(tx, actor, {
              action: 'payComponent.versionWithdrawn',
              entityType: 'PayComponent',
              entityId: restored.id,
              reason:
                `Withdrew the unstarted v${open.version} of ${dto.code} (would have begun ` +
                `${open.effectiveFrom.toISOString().slice(0, 10)}); the treatment in force is unchanged. ` +
                `Given: ${dto.reason.trim()}`,
              before: open,
              after: restored,
            });
            return restored;
          }

          const corrected = await tx.payComponent.update({
            where: { id: open.id },
            data: {
              ...data,
              effectiveFrom: from,
              clinicOverride: true,
              changeReason: dto.reason.trim(),
              createdByStaffId: actor.id,
            },
          });
          await recordAudit(tx, actor, {
            action: 'payComponent.versionCorrected',
            entityType: 'PayComponent',
            entityId: corrected.id,
            reason:
              `Corrected v${corrected.version} of ${corrected.code} before it took effect ` +
              `(${from.toISOString().slice(0, 10)}), set by this clinic and UNVERIFIED: ${dto.reason.trim()}`,
            before: open,
            after: corrected,
          });
          return corrected;
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
          reason: `${saved.code} v${saved.version} from ${from.toISOString().slice(0, 10)}, set by this clinic and UNVERIFIED: ${dto.reason.trim()}`,
          before: open,
          after: saved,
        });
        return saved;
      }

      /*
       * MOVING A PLAN'S DATE WITH NOTHING ELSE CHANGED.
       *
       * Reaching here means no treatment field moved — the block above returns
       * whenever one does. Until now that also meant the date could not move:
       * `data` carries no `effectiveFrom`, so the in-place update below kept
       * whatever the version already had, and an owner whose switches were
       * already right had no way to say "same treatment, different month". The
       * only route was to save a flag at a value they did not want and then
       * correct it — two versions, and a decision in the audit log that was
       * never made, to move one date.
       *
       * Allowed only while the version HAS NOT STARTED, for the reason the
       * correction path above already gives: nothing is paid under a plan, so
       * moving it rewrites no money. A version in force keeps its date.
       *
       * The approved-run guard applies here too, so a plan still cannot be
       * moved into a month that is settled.
       */
      if (open && notYetStarted && dto.effectiveFrom) {
        const from = new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
        if (from.getTime() !== open.effectiveFrom.getTime()) {
          if (!dto.reason || dto.reason.trim().length < 4) {
            throw new BadRequestException(
              `Moving when "${dto.code}" starts changes which months it prices. Send a reason: it is kept with ` +
                'this version and shown beside the figures it produces.',
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
              `${approvedCovering} approved payroll run(s) cover ${dto.effectiveFrom.slice(0, 10)} or later. ` +
                'What was paid is settled; start this version from a period that has not been approved.',
            );
          }
          const moved = await tx.payComponent.update({
            where: { id: open.id },
            data: { ...data, effectiveFrom: from, clinicOverride: true, changeReason: dto.reason.trim() },
          });
          await recordAudit(tx, actor, {
            action: 'payComponent.versionCorrected',
            entityType: 'PayComponent',
            entityId: moved.id,
            reason:
              `Moved v${moved.version} of ${moved.code} from ` +
              `${open.effectiveFrom.toISOString().slice(0, 10)} to ${from.toISOString().slice(0, 10)} ` +
              `before it took effect; its treatment is unchanged: ${dto.reason.trim()}`,
            before: open,
            after: moved,
          });
          return moved;
        }
      }

      // The version in force started earlier than recorded: same treatment, earlier date.
      if (open && !notYetStarted && dto.effectiveFrom) {
        const from = new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
        if (from < open.effectiveFrom) {
          if (!dto.reason || dto.reason.trim().length < 4) {
            throw new BadRequestException(`Moving when "${dto.code}" starts changes which months it prices. Send a reason: it is kept with the change.`);
          }
          return correctStart(tx, actor, open, from, dto.reason.trim());
        }
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
