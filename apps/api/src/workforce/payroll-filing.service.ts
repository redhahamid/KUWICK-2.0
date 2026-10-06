import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PayrollRunStatus, PayrollRunType } from "@prisma/client";
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from "../core/tenant-scoped-prisma.provider";
import { PrismaService } from "../core/prisma.service";
import { withAdminTx } from "../finance/admin-actor";
import { recordAudit } from "../finance/admin-audit";
import { currentTenantId } from "../core/tenant-context";
import { SnapshotPayload } from "./payroll-snapshot";
import { resolveEmployerProfileForPayroll } from "./statutory-classification";
import {
  OutputScheme,
  PayrollStatutoryOutputService,
} from "./payroll-statutory-output.service";

/**
 * THE FILING HELPER — the approved month, arranged the way each authority's
 * portal asks for it.
 *
 * The statutory outputs are prepared per SCHEME, because that is how the
 * engine computes them. A person filing the month works per AGENCY: one
 * sitting at KWSP, one at PERKESO (where SOCSO, EIS and SKBBK are keyed
 * together), one at LHDN, one at HRD Corp. This service regroups the same
 * frozen figures per agency, orders the list the way a portal is read (by
 * name, with the IC and the membership number beside it), says who joined
 * and who left this month — the two questions a listing alone never answers,
 * since a portal wants the new employee added and the leaver removed — and
 * records "submitted" per agency, which writes the same date and reference
 * on every scheme the agency covers.
 *
 * Nothing here generates a file. The boundary the outputs service draws
 * stands: Kuwick prepares; a person files; the person records it.
 */
export const FILING_AGENCIES = [
  {
    agency: "KWSP",
    label: "KWSP (EPF)",
    portal: "KWSP i-Akaun (Majikan)",
    schemes: ["EPF"],
  },
  {
    agency: "PERKESO",
    label: "PERKESO (SOCSO, EIS and LINDUNG 24 JAM)",
    portal: "PERKESO ASSIST Portal",
    schemes: ["SOCSO", "EIS", "LINDUNG"],
  },
  {
    agency: "LHDN",
    label: "LHDN (PCB / MTD)",
    portal: "LHDN e-PCB Plus",
    schemes: ["PCB"],
  },
  {
    agency: "HRD",
    label: "HRD Corp (levy)",
    portal: "HRD Corp e-TRiS",
    schemes: ["HRD"],
  },
] as const;
export type FilingAgency = (typeof FILING_AGENCIES)[number]["agency"];

const MONTH = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const DAY = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

interface FilingRow {
  staffId: string;
  name: string;
  identifier: string | null;
  membershipNo: string | null;
  /** The agency's schemes, each with its two shares; null where not calculated. */
  parts: Record<
    string,
    { employeeCents: number | null; employerCents: number | null }
  >;
  employeeCents: number | null;
  employerCents: number | null;
  totalCents: number | null;
  note: string | null;
  basisNote: string | null;
}

interface FilingMove {
  staffId: string;
  name: string;
  identifier: string | null;
  membershipNo: string | null;
  /** Why the portal needs to hear about this person this month. */
  reason: string;
}

@Injectable()
export class PayrollFilingService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA)
    private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly outputs: PayrollStatutoryOutputService,
  ) {}

  async view(runId: string) {
    return withAdminTx(
      this.rawPrisma,
      "hr.payroll.export.statutory",
      async (tx, actor) => {
        const view = await this.compose(runId);
        await recordAudit(tx, actor, {
          action: "payrollStatutory.filingViewed",
          entityType: "PayrollRun",
          entityId: runId,
          after: {
            agencies: view.agencies.map(
              (row) => `${row.agency}:${row.rows.length}`,
            ),
          },
          source: "hr.payroll",
        });
        return view;
      },
    );
  }

  /**
   * "Submitted" for an agency: one date and one reference, written on every
   * scheme that agency covers, so the per-scheme record the reports and the
   * finance contract already read stays the single source.
   */
  async recordSubmission(
    runId: string,
    agency: string,
    body: { submittedDate: string; reference: string; note?: string },
  ) {
    const upper = agency.toUpperCase() as FilingAgency;
    const definition = FILING_AGENCIES.find((row) => row.agency === upper);
    if (!definition)
      throw new NotFoundException(`No filing agency is called "${agency}".`);
    await withAdminTx(
      this.rawPrisma,
      "hr.payroll.export.statutory",
      async (tx, actor) => {
        // Said plainly (UAT, 6 October 2026): an empty box is "please enter
        // it", a two-letter one is "check it".
        if (!body.reference || body.reference.trim() === "") {
          throw new ConflictException("Please enter the portal reference.");
        }
        if (body.reference.trim().length < 3) {
          throw new ConflictException(
            "That portal reference looks too short. Please check it against the portal.",
          );
        }
        if (
          !body.submittedDate ||
          Number.isNaN(new Date(body.submittedDate).getTime())
        ) {
          throw new ConflictException(
            "Recording a submission needs the date it was filed.",
          );
        }
        const composed = await this.outputs.compose(runId);
        const run = await this.prisma.payrollRun.findUnique({
          where: { id: runId },
        });
        if (!run) throw new NotFoundException("Payroll run not found");
        const period = new Date(
          Date.UTC(run.period.getUTCFullYear(), run.period.getUTCMonth(), 1),
        );
        const periodEnd = new Date(
          Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0),
        );
        const block = this.agencyBlock(
          definition,
          composed.view,
          [],
          [],
          await this.hrdRegisteredFor(run.legalEmployerId, period, periodEnd),
        );
        if (!block.applicable) {
          throw new ConflictException(
            `${definition.label} has nothing to file this month: ${block.note ?? "not applicable."}`,
          );
        }
        const already = composed.view.schemes.filter(
          (row) =>
            (definition.schemes as readonly string[]).includes(row.scheme) &&
            row.submission !== null,
        );
        if (already.length > 0) {
          throw new ConflictException(
            `${definition.label} is already recorded as submitted for this month (${already
              .map(
                (row) =>
                  `${row.scheme}: ${row.submission?.reference} on ${row.submission?.submittedDate}`,
              )
              .join(
                "; ",
              )}). A filing is recorded once; add corrections at the authority, not as a second claim here.`,
          );
        }
        for (const scheme of definition.schemes) {
          await tx.payrollStatutorySubmission.create({
            data: {
              tenantId: currentTenantId(),
              payrollRunId: runId,
              scheme,
              snapshotVersion: composed.snapshotVersion,
              snapshotHash: composed.snapshotHash,
              submittedDate: new Date(`${body.submittedDate}T00:00:00.000Z`),
              reference: body.reference.trim(),
              note: body.note?.trim() || null,
              recordedByStaffId: actor.id,
            },
          });
        }
        await recordAudit(tx, actor, {
          action: "payrollStatutory.filingRecorded",
          entityType: "PayrollRun",
          entityId: runId,
          after: {
            agency: upper,
            schemes: [...definition.schemes],
            submittedDate: body.submittedDate,
            reference: body.reference.trim(),
          },
          source: "hr.payroll",
        });
      },
    );
    return this.view(runId);
  }

  // -------------------------------------------------------------------------

  private async hrdRegisteredFor(
    legalEmployerId: string | null,
    period: Date,
    periodEnd: Date,
  ): Promise<boolean> {
    if (!legalEmployerId) return false;
    const rows = await this.prisma.legalEmployerStatutoryProfile.findMany({
      where: { legalEmployerId },
      orderBy: { effectiveFrom: "asc" },
    });
    const outcome = resolveEmployerProfileForPayroll(
      rows.map((row) => ({
        id: row.id,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        hrdRegistration: row.hrdRegistration,
      })),
      period,
      periodEnd,
    );
    return (
      outcome.kind === "RESOLVED" &&
      outcome.row.hrdRegistration !== "NOT_REGISTERED"
    );
  }

  private async compose(runId: string) {
    const composed = await this.outputs.compose(runId);
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException("Payroll run not found");

    const period = new Date(
      Date.UTC(run.period.getUTCFullYear(), run.period.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0),
    );
    const previousPeriod = new Date(
      Date.UTC(period.getUTCFullYear(), period.getUTCMonth() - 1, 1),
    );

    const staffIds = composed.payload.employees.map((row) => row.staffId);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { staffId: { in: staffIds } },
      select: { staffId: true, startDate: true, endDate: true },
    });
    const profileByStaff = new Map(profiles.map((row) => [row.staffId, row]));

    // HRD Corp is an agency only for a registered employer: the employer's
    // statutory profile in force on the month's last day, the same reading
    // the engine made. A zero levy on every row is not it.
    const hrdRegistered = await this.hrdRegisteredFor(
      run.legalEmployerId,
      period,
      periodEnd,
    );

    // Last month's approved record for the same employer and branch — the
    // other half of "who is new and who is gone": a joiner is on this month's
    // list and not last month's; a leaver the other way round.
    const previousRun = await this.prisma.payrollRun.findFirst({
      where: {
        legalEmployerId: run.legalEmployerId,
        clinicId: run.clinicId,
        runType: PayrollRunType.REGULAR,
        period: previousPeriod,
        status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
      },
      select: { id: true },
    });
    const previousSnapshot = previousRun
      ? await this.prisma.payrollSnapshot.findFirst({
          where: { payrollRunId: previousRun.id },
          orderBy: { version: "desc" },
          select: { payload: true },
        })
      : null;
    const previousEmployees = previousSnapshot
      ? (previousSnapshot.payload as unknown as SnapshotPayload).employees
      : null;
    const previousIds = new Set(
      (previousEmployees ?? []).map((row) => row.staffId),
    );
    const previousMonth = MONTH(previousPeriod);

    const inPeriod = (date: Date | null | undefined) =>
      date !== null &&
      date !== undefined &&
      date >= period &&
      date <= periodEnd;

    const joiners: Omit<FilingMove, "membershipNo">[] = [];
    const leavers: Omit<FilingMove, "membershipNo">[] = [];
    for (const employee of composed.payload.employees) {
      const profile = profileByStaff.get(employee.staffId);
      const identifier = composed.identifierOf(employee.staffId);
      if (inPeriod(profile?.startDate)) {
        joiners.push({
          staffId: employee.staffId,
          name: employee.name,
          identifier,
          reason: `Started ${DAY(profile!.startDate!)}`,
        });
      } else if (previousEmployees && !previousIds.has(employee.staffId)) {
        joiners.push({
          staffId: employee.staffId,
          name: employee.name,
          identifier,
          reason: `Not on ${previousMonth}'s approved payroll`,
        });
      }
      if (inPeriod(profile?.endDate)) {
        leavers.push({
          staffId: employee.staffId,
          name: employee.name,
          identifier,
          reason: `Last day ${DAY(profile!.endDate!)}: on this month's filing, then removed`,
        });
      }
    }
    const thisIds = new Set(staffIds);
    const gone = (previousEmployees ?? []).filter(
      (row) => !thisIds.has(row.staffId),
    );
    const goneProfiles =
      gone.length > 0
        ? await this.prisma.employeeProfile.findMany({
            where: { staffId: { in: gone.map((row) => row.staffId) } },
            select: {
              staffId: true,
              identifierValue: true,
              epfNumber: true,
              socsoNumber: true,
              taxNumber: true,
              endDate: true,
            },
          })
        : [];
    const goneByStaff = new Map(goneProfiles.map((row) => [row.staffId, row]));
    for (const row of gone) {
      const profile = goneByStaff.get(row.staffId);
      leavers.push({
        staffId: row.staffId,
        name: row.name,
        identifier: profile?.identifierValue ?? null,
        reason: profile?.endDate
          ? `On ${previousMonth}'s payroll; last day ${DAY(profile.endDate)}`
          : `On ${previousMonth}'s payroll, not this month's`,
      });
    }
    const byName = <T extends { name: string }>(a: T, b: T) =>
      a.name.localeCompare(b.name);
    joiners.sort(byName);
    leavers.sort(byName);

    const membershipFor = (
      agency: FilingAgency,
      staffId: string,
    ): string | null => {
      const block = composed.view.schemes.find(
        (row) =>
          row.scheme ===
          FILING_AGENCIES.find((a) => a.agency === agency)!.schemes[0],
      );
      const found = block?.rows.find((row) => row.staffId === staffId);
      if (found) return found.membershipNo;
      const profile = goneByStaff.get(staffId);
      if (!profile) return null;
      return agency === "KWSP"
        ? profile.epfNumber
        : agency === "PERKESO"
          ? profile.socsoNumber
          : agency === "LHDN"
            ? profile.taxNumber
            : null;
    };

    const agencies = FILING_AGENCIES.map((definition) =>
      this.agencyBlock(
        definition,
        composed.view,
        joiners.map((row) => ({
          ...row,
          membershipNo: membershipFor(definition.agency, row.staffId),
        })),
        leavers.map((row) => ({
          ...row,
          membershipNo: membershipFor(definition.agency, row.staffId),
        })),
        hrdRegistered,
      ),
    );

    return {
      runId,
      period: composed.view.period,
      periodLabel: MONTH(period),
      employerName: composed.view.employerName,
      employerIdentity: composed.view.employerIdentity,
      snapshotVersion: composed.view.snapshotVersion,
      previousMonth: previousEmployees ? previousMonth : null,
      notASubmission:
        "Prepared from the approved month for keying at each authority’s own portal. Kuwick files nothing and makes " +
        "no upload file: an agency reads as submitted only when a person records the filing here with the date and " +
        "the reference the portal issued.",
      agencies,
    };
  }

  private agencyBlock(
    definition: (typeof FILING_AGENCIES)[number],
    view: Awaited<ReturnType<PayrollStatutoryOutputService["compose"]>>["view"],
    joiners: FilingMove[],
    leavers: FilingMove[],
    hrdRegistered: boolean,
  ) {
    const blocks = view.schemes.filter((row) =>
      (definition.schemes as readonly string[]).includes(row.scheme),
    );
    const rowsByStaff = new Map<string, FilingRow>();
    for (const block of blocks) {
      for (const row of block.rows) {
        const existing = rowsByStaff.get(row.staffId) ?? {
          staffId: row.staffId,
          name: row.name,
          identifier: row.identifier,
          membershipNo: row.membershipNo,
          parts: {},
          employeeCents: 0,
          employerCents: 0,
          totalCents: 0,
          note: null,
          basisNote: null,
        };
        existing.parts[block.scheme] = {
          employeeCents: row.employeeCents,
          employerCents: row.employerCents,
        };
        if (row.employeeCents === null || row.employerCents === null) {
          existing.employeeCents = null;
          existing.employerCents = null;
          existing.totalCents = null;
          existing.note = row.note ?? existing.note;
        } else if (
          existing.employeeCents !== null &&
          existing.employerCents !== null &&
          existing.totalCents !== null
        ) {
          existing.employeeCents += row.employeeCents;
          existing.employerCents += row.employerCents;
          existing.totalCents += row.employeeCents + row.employerCents;
        }
        if (row.basisNote) existing.basisNote = row.basisNote;
        rowsByStaff.set(row.staffId, existing);
      }
    }
    const rows = [...rowsByStaff.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    // HRD: an agency only for a registered employer; see compose().
    const applicable = definition.agency !== "HRD" || hrdRegistered;
    const notComputed = applicable
      ? rows.filter((row) => row.note !== null).length
      : 0;
    const employeeTotalCents =
      !applicable || notComputed > 0
        ? null
        : rows.reduce((sum, row) => sum + (row.employeeCents ?? 0), 0);
    const employerTotalCents =
      !applicable || notComputed > 0
        ? null
        : rows.reduce((sum, row) => sum + (row.employerCents ?? 0), 0);
    const submissions = blocks.map((block) => ({
      scheme: block.scheme as OutputScheme,
      submission: block.submission,
    }));
    const recorded = submissions.filter((row) => row.submission !== null);
    const first = recorded[0]?.submission ?? null;
    return {
      agency: definition.agency,
      label: definition.label,
      portal: definition.portal,
      schemes: [...definition.schemes],
      applicable,
      note: applicable
        ? null
        : "Not registered with HRD Corp: no levy is due this month.",
      rows: applicable ? rows : [],
      joiners: applicable ? joiners : [],
      leavers: applicable ? leavers : [],
      notComputed,
      employeeTotalCents,
      employerTotalCents,
      totalCents:
        employeeTotalCents === null || employerTotalCents === null
          ? null
          : employeeTotalCents + employerTotalCents,
      submission: {
        state: !applicable
          ? "NOT_APPLICABLE"
          : recorded.length === 0
            ? "NOT_RECORDED"
            : recorded.length === submissions.length
              ? "RECORDED"
              : "PARTIAL",
        submittedDate: first?.submittedDate ?? null,
        reference: first?.reference ?? null,
        recordedBy: first?.recordedBy ?? null,
        recordedAt: first?.recordedAt ?? null,
        perScheme: submissions.map((row) => ({
          scheme: row.scheme,
          recorded: row.submission !== null,
          reference: row.submission?.reference ?? null,
        })),
      },
    };
  }
}
