import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from "../core/tenant-scoped-prisma.provider";
import { PrismaService } from "../core/prisma.service";
import { currentTenantId } from "../core/tenant-context";
import {
  AdminTx,
  actorCan,
  requirePermission,
  withAdminTx,
} from "../finance/admin-actor";
import { recordAudit } from "../finance/admin-audit";
import type { ActingStaff } from "../clinical/clinical-actor";
import { catalogueFor } from "./component-liability";
import { RecordContributionBasisDto } from "./dto/record-contribution-basis.dto";
import type { BulkEpfBasisDto } from "./dto/bulk-epf-basis.dto";

/**
 * THE EMPLOYER-SELECTED CONTRIBUTION BASIS — capture and history.
 *
 * Two concepts, deliberately apart, and this service owns only the second:
 *
 *  - The ASSESSMENT — which components ARE EPF wages — lives in the
 *    pay-component catalogue, per component, dated, with a verification
 *    status and a source. Nothing here reads or writes a liability flag.
 *  - The SELECTION — which of those wages the employer has CHOSEN to
 *    contribute on — is what these rows record: mode, ticked codes, a date,
 *    a required reason and the name of whoever decided.
 *
 * A selection that leaves assessed wages out is stored faithfully (it is the
 * employer's auditable preference) and the RUN raises the blocking statutory
 * discrepancy against it. Storing it is not endorsing it, and this service
 * says so in the capture response rather than leaving the discovery to the
 * exception centre.
 *
 * Permission shape mirrors salary exactly: reading pay structure is
 * `hr.salary.view`; writing it takes `hr.employee.manage` AND payroll access,
 * because a basis decides other people's statutory money.
 */
@Injectable()
export class ContributionBasisService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * History plus the vocabulary the selection editor needs: every EARNING
   * component in today's catalogue with its EPF assessment and verification,
   * so the panel can show "EPF wages" / "outside EPF wages" beside each tick
   * without a second source of truth growing in the browser.
   */
  async history(staffId: string) {
    await requirePermission(this.rawPrisma, "hr.salary.view");
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { staffId },
    });
    if (!profile) throw new NotFoundException("Employee not found");

    const rows = await this.prisma.employeeContributionBasis.findMany({
      where: { staffId, scheme: "EPF" },
      orderBy: { effectiveFrom: "desc" },
      include: { createdBy: { select: { fullName: true } } },
    });

    const catalogueRows = await this.prisma.payComponent.findMany({
      where: {},
    });
    const catalogue = catalogueFor(catalogueRows, new Date());
    const components = [...catalogue.values()]
      // A PICKER, so `active` belongs here. `catalogueFor` no longer drops a
      // switched-off component — a month that already names one still has to
      // price — but offering one for a NEW basis would be offering something
      // the clinic has said it no longer keys.
      .filter((component) => component.active && component.kind === "EARNING")
      .map((component) => ({
        code: component.code,
        label: component.label,
        epfLiable: component.liability.epf,
        verification: component.verification,
        sourceRef: component.sourceRef,
      }))
      .sort((a, b) =>
        a.code === "BASIC"
          ? -1
          : b.code === "BASIC"
            ? 1
            : a.label.localeCompare(b.label),
      );

    return {
      scheme: "EPF",
      versions: rows.map((row) => ({
        id: row.id,
        mode: row.mode,
        includedComponentCodes: row.includedComponentCodes,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: row.effectiveTo
          ? row.effectiveTo.toISOString().slice(0, 10)
          : null,
        reason: row.reason,
        note: row.note,
        recordedBy: row.createdBy?.fullName ?? null,
        recordedAt: row.createdAt.toISOString(),
        current: !row.effectiveTo,
        /** Closed into an empty interval by a same-day re-record: never in
         * force for any period, kept because the decision was still made. */
        superseded:
          row.effectiveTo !== null && row.effectiveTo < row.effectiveFrom,
      })),
      components,
    };
  }

  async record(staffId: string, dto: RecordContributionBasisDto) {
    return withAdminTx(
      this.rawPrisma,
      "hr.employee.manage",
      async (tx, actor) => {
        // Same rule as the salary and the bank field: `hr.employee.manage` says
        // who maintains employee records, payroll access says who may touch the
        // money — and a contribution basis IS the money.
        if (!actorCan(actor, "hr.payroll.view")) {
          throw new ForbiddenException(
            "Selecting a contribution basis needs payroll access, not employee-record access alone.",
          );
        }
        return writeEpfBasis(tx, actor, staffId, dto);
      },
    );
  }

  /**
   * EVERY EMPLOYEE OF A BRANCH, ONE BASIS, FROM ONE DATE (UAT, 10 October
   * 2026): "Set EPF basis for all staff in this branch". Everybody employed
   * there on or after the date, leavers included up to their last day, gets
   * their own dated record through the same rules as their own page. All or
   * nothing: somebody whose approved months the date reaches stops the whole
   * batch, named, rather than leaving the branch half-changed.
   */
  async recordForBranch(dto: BulkEpfBasisDto) {
    return withAdminTx(this.rawPrisma, "hr.employee.manage", async (tx, actor) => {
      if (!actorCan(actor, "hr.payroll.view")) {
        throw new ForbiddenException(
          "Selecting a contribution basis needs payroll access, not employee-record access alone.",
        );
      }
      const from = new Date(`${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime())) throw new BadRequestException("effectiveFrom must be a YYYY-MM-DD date.");
      const clinic = await tx.clinic.findFirst({ where: { id: dto.clinicId }, select: { id: true, name: true } });
      if (!clinic) throw new NotFoundException("Branch not found");

      const people = await tx.employeeProfile.findMany({
        where: {
          engagement: "EMPLOYEE",
          staff: { clinicId: clinic.id },
          OR: [{ endDate: null }, { endDate: { gte: from } }],
          employmentStatus: { not: "SUSPENDED" },
        },
        select: { staffId: true, employeeNo: true, staff: { select: { fullName: true } } },
        orderBy: { staffId: "asc" },
      });
      const staffIds = people.map((person) => person.staffId);
      const [bases, approved] = await Promise.all([
        tx.employeeContributionBasis.findMany({ where: { staffId: { in: staffIds }, scheme: "EPF" }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] }),
        tx.payrollLine.findMany({
          where: {
            staffId: { in: staffIds },
            payrollRun: {
              status: { in: ["APPROVED", "PAID"] },
              period: { gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)) },
            },
          },
          select: { staffId: true },
        }),
      ]);
      const lockedFor = new Set(approved.map((row) => row.staffId));
      const live = (row: { effectiveFrom: Date; effectiveTo: Date | null }) => !(row.effectiveTo !== null && row.effectiveTo < row.effectiveFrom);

      const rows = people.map((person) => {
        const own = bases.filter((row) => row.staffId === person.staffId && live(row));
        const governing = [...own].reverse().find((row) => row.effectiveFrom <= from && (row.effectiveTo === null || row.effectiveTo >= from)) ?? null;
        const later = own.filter((row) => row.effectiveFrom > from).length;
        const current = governing?.mode ?? "ALL_APPLICABLE";
        const action = lockedFor.has(person.staffId)
          ? ("BLOCKED" as const)
          : current === dto.mode && later === 0 && (governing === null ? dto.mode === "ALL_APPLICABLE" : governing.includedComponentCodes.length === 0)
            ? ("SAME" as const)
            : ("CHANGE" as const);
        return { staffId: person.staffId, name: person.staff.fullName, employeeNo: person.employeeNo, current, action };
      });
      const blocked = rows.filter((row) => row.action === "BLOCKED");
      const changing = rows.filter((row) => row.action === "CHANGE");
      const summary = {
        clinicId: clinic.id,
        branch: clinic.name,
        mode: dto.mode,
        effectiveFrom: dto.effectiveFrom.slice(0, 10),
        people: rows.length,
        changing: changing.length,
        unchanged: rows.filter((row) => row.action === "SAME").length,
        blocked: blocked.length,
        rows,
      };
      if (!dto.commit) return { ...summary, committed: false };
      if (blocked.length > 0) {
        throw new ConflictException(
          `${blocked.map((row) => row.name).join(", ")} ${blocked.length === 1 ? "has" : "have"} approved payroll from ${dto.effectiveFrom.slice(0, 10)} on. ` +
            "Nothing was changed. Choose a date after the last approved month, or set them one by one.",
        );
      }
      for (const row of changing) {
        await writeEpfBasis(tx, actor, row.staffId, {
          scheme: "EPF",
          mode: dto.mode,
          effectiveFrom: dto.effectiveFrom.slice(0, 10),
          reason: `${dto.reason} (set for all staff in ${clinic.name})`,
        });
      }
      await recordAudit(tx, actor, {
        action: "employeeContributionBasis.branchRecorded",
        entityType: "Clinic",
        entityId: clinic.id,
        reason: `Set EPF basis ${dto.mode === "BASIC_ONLY" ? "basic salary only" : "all EPF-liable pay"} from ${dto.effectiveFrom.slice(0, 10)} for ${changing.length} of ${rows.length} staff in ${clinic.name}: ${dto.reason}`,
        after: { mode: dto.mode, effectiveFrom: dto.effectiveFrom.slice(0, 10), changed: changing.length, unchanged: summary.unchanged, staffIds: changing.map((row) => row.staffId) },
      });
      return { ...summary, committed: true };
    }, { timeout: 60_000 });
  }
}

/**
 * RECORD ONE PERSON'S EPF BASIS from a date, inside the caller's
 * transaction. The one place the rules live: the person's own panel, the
 * branch-wide action on the Employees page and the employer's default for
 * new staff all come through here (UAT, 10 October 2026). The caller checks
 * permissions.
 */
export async function writeEpfBasis(tx: AdminTx, actor: ActingStaff, staffId: string, dto: RecordContributionBasisDto) {
    const profile = await tx.employeeProfile.findFirst({
      where: { staffId },
    });
    if (!profile) throw new NotFoundException("Employee not found");

    const from = new Date(
      `${dto.effectiveFrom.slice(0, 10)}T00:00:00.000Z`,
    );
    if (Number.isNaN(from.getTime()))
      throw new BadRequestException(
        "effectiveFrom must be a YYYY-MM-DD date.",
      );

    /*
     * THE TICKED CODES ARE VOCABULARY, so they are checked against the
     * catalogue in force on the selection's own start date — an unknown
     * code would sit in the row meaning nothing forever. BASIC is always
     * in the basis and never stored: keeping it out of the column means
     * there is exactly one statement of that rule (the engine's), not two
     * that can drift.
     */
    let includedCodes: string[] = [];
    if (dto.mode === "BASIC_PLUS_SELECTED") {
      const provided = [
        ...new Set(dto.includedComponentCodes ?? []),
      ].filter((code) => code !== "BASIC");
      const catalogue = catalogueFor(
        await tx.payComponent.findMany({ where: {} }),
        from,
      );
      for (const code of provided) {
        const component = catalogue.get(code);
        if (!component) {
          throw new BadRequestException(
            `"${code}" is not a pay component in force on ${dto.effectiveFrom}, so it cannot be part of a basis.`,
          );
        }
        if (!component.active) {
          throw new BadRequestException(
            `${component.label} is switched off in Payroll items, so it cannot be added to a basis. ` +
              "Months that already name it still price normally; this is about what is chosen from now on.",
          );
        }
        if (component.kind !== "EARNING") {
          throw new BadRequestException(
            `${component.label} is not an earning — a contribution basis selects income, not deductions.`,
          );
        }
      }
      includedCodes = provided;
    } else if (
      dto.includedComponentCodes &&
      dto.includedComponentCodes.length > 0
    ) {
      throw new BadRequestException(
        `Ticked components only make sense with "basic + selected income". Under "${
          dto.mode === "BASIC_ONLY"
            ? "basic salary only"
            : "all applicable earnings"
        }" the list is decided by the mode itself.`,
      );
    }

    // A basis change inside an already-approved period would make the
    // approved run and the record disagree — same guard as the salary.
    const approvedCovering = await tx.payrollRun.count({
      where: {
        status: { in: ["APPROVED", "PAID"] },
        period: {
          gte: new Date(
            Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
          ),
        },
        lines: { some: { staffId } },
      },
    });
    if (approvedCovering > 0) {
      throw new ConflictException(
        `${approvedCovering} approved payroll run(s) cover this date or later for this employee. ` +
          "What they were contributed on is settled. Record the change from a period that has not been approved, or reopen the run and correct it deliberately.",
      );
    }

    /*
     * WHAT IS RECORDED FROM DAY F BECOMES THE SELECTION FROM F ONWARDS —
     * the one correction rule a clinic owner can hold in their head.
     *
     * Every LIVE row starting on or after F is SUPERSEDED: closed into an
     * empty interval (effectiveTo before its own effectiveFrom) that
     * resolution ignores and history keeps, so a selection tried and
     * reverted leaves a truthful trail instead of a dead end — a month
     * mid-period-blocked by an experiment can always be reunified by
     * recording the intended selection from the intended day. The row
     * governing the eve of F is (re)closed at F−1: its recorded FACTS —
     * mode, codes, date, reason, author — are never edited; only its
     * derived in-force window is, and only because the rows that used to
     * define that window have just been replaced.
     *
     * Safe because of the guard above: everything from F onward is
     * unapproved territory, so no approved run ever resolved what this
     * replaces.
     */
    const allRows = await tx.employeeContributionBasis.findMany({
      where: { staffId, scheme: dto.scheme },
      orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
    });
    const isSuperseded = (row: {
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }) => row.effectiveTo !== null && row.effectiveTo < row.effectiveFrom;
    const live = allRows.filter((row) => !isSuperseded(row));
    const future = live.filter((row) => row.effectiveFrom >= from);
    const prior =
      [...live].reverse().find((row) => row.effectiveFrom < from) ?? null;
    const governing =
      [...live]
        .reverse()
        .find(
          (row) =>
            row.effectiveFrom <= from &&
            (row.effectiveTo === null || row.effectiveTo >= from),
        ) ?? null;

    // A record that changes nothing from F onward is a row with no fact in
    // it. Replacing recorded-but-different future rows IS a change, even
    // when the content matches what governs today.
    if (
      future.length === 0 &&
      governing &&
      governing.mode === dto.mode &&
      [...governing.includedComponentCodes].sort().join(",") ===
        [...includedCodes].sort().join(",")
    ) {
      throw new BadRequestException(
        "Nothing in this basis differs from the one already in force, so there is no new fact to record.",
      );
    }

    const dayBefore = new Date(from.getTime() - 86400000);
    for (const row of future) {
      await tx.employeeContributionBasis.update({
        where: { id: row.id },
        data: {
          effectiveTo: new Date(row.effectiveFrom.getTime() - 86400000),
        },
      });
    }
    if (prior) {
      await tx.employeeContributionBasis.update({
        where: { id: prior.id },
        data: { effectiveTo: dayBefore },
      });
    }

    const saved = await tx.employeeContributionBasis.create({
      data: {
        tenantId: currentTenantId(),
        staffId,
        scheme: dto.scheme,
        mode: dto.mode,
        includedComponentCodes: includedCodes,
        effectiveFrom: from,
        reason: dto.reason,
        note: dto.note ?? null,
        createdByStaffId: actor.id,
      },
    });

    await recordAudit(tx, actor, {
      action: "employeeContributionBasis.recorded",
      entityType: "EmployeeContributionBasis",
      entityId: saved.id,
      reason: `Selected ${dto.mode} EPF basis from ${dto.effectiveFrom}: ${dto.reason}`,
      before: governing
        ? {
            mode: governing.mode,
            includedComponentCodes: governing.includedComponentCodes,
          }
        : null,
      after: {
        mode: dto.mode,
        includedComponentCodes: includedCodes,
        effectiveFrom: dto.effectiveFrom,
        supersededRows: future.length,
      },
    });

    return {
      id: saved.id,
      mode: saved.mode,
      includedComponentCodes: saved.includedComponentCodes,
      effectiveFrom: dto.effectiveFrom,
      // Storing a preference is not endorsing it. Whether this selection
      // leaves assessed wages out is a fact about a MONTH's actual pay, so
      // the run decides it — and blocks on it — at calculation time.
      notEndorsed:
        dto.mode === "ALL_APPLICABLE"
          ? null
          : "Recorded as the employer’s selection. If a month pays EPF-liable income this basis leaves out, " +
            "that month will show a statutory discrepancy and cannot be approved until it is resolved.",
    };
}
