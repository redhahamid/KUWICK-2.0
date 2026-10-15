import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { currentTenantId } from '../core/tenant-context';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { withAdminTx, withScopedAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents } from '../finance/money';
import { compareByEmployeeName } from './employee-order';
import { CSV_BOM, csvCell, csvTextCell } from './csv';
import { EA_BOXES, EaBox, EaItem, EaMonth, eaFigures } from './ea-form';
import type { SnapshotPayload } from './payroll-snapshot';

export interface EaProblem {
  /** BLOCK: the form cannot be filed as it is. CHECK: worth a look before filing. */
  level: 'BLOCK' | 'CHECK';
  text: string;
}

export interface EaForm {
  staffId: string;
  legalEmployerId: string;
  year: number;
  employer: {
    name: string;
    lhdnEmployerNo: string | null;
    address: string | null;
    addressLines: string[];
    phone: string | null;
    /** "Nama Pegawai" and "Jawatan": an employer setting. */
    signerName: string | null;
    signerPosition: string | null;
  };
  /** "Tarikh": the day the forms are issued, 31 December of the year unless chosen. */
  issueDate: string;
  /** "No. Siri": a running number per employer and year, in name order. */
  serialNo: string;
  /** The form revision printed top left, e.g. "(C.P.8A - Pin. 2017)": a clinic setting. */
  versionLabel: string;
  /** Item names per box, for "Perihal pembayaran" (B1c) and "Nyatakan" (B3). */
  labels: Partial<Record<EaBox, string[]>>;
  employee: {
    name: string;
    employeeNo: string | null;
    position: string | null;
    idType: string | null;
    idNumber: string | null;
    taxNumber: string | null;
    epfNumber: string | null;
    socsoNumber: string | null;
    /** Only when they joined or left during the year. */
    startDate: string | null;
    endDate: string | null;
  };
  /** Cents per box; NONE is what was paid but does not go on the form. */
  boxes: Record<EaBox, number>;
  pcbCents: number;
  cp38Cents: number;
  zakatCents: number;
  tp1ReliefCents: number;
  qualifyingChildren: number;
  epfCents: number;
  /** SOCSO and EIS, the employee's share. */
  socsoCents: number;
  status: 'READY' | 'CHECK' | 'INCOMPLETE';
  problems: EaProblem[];
}

/** The C.P.8A revision printed on the form; the clinic updates it when LHDN issues a newer one. */
export const EA_VERSION_SETTING = 'hr.eaForm.versionLabel';
export const EA_VERSION_DEFAULT = '(C.P.8A - Pin. 2017)';

const APPROVED = ['APPROVED', 'PAID'];
const MONTH = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const inYear = (date: Date | null, year: number) => (date && date.getUTCFullYear() === year ? iso(date) : null);

/**
 * THE YEAR-END FORMS (overnight brief, 15 October 2026): Borang EA per
 * employee and the Borang E summary, from approved months only.
 *
 * Totals (tax, zakat, EPF, SOCSO) come from the year-to-date record the
 * approved months wrote, which is what monthly tax already reads. The split
 * of pay into boxes comes from each approved month's frozen item lines.
 */
@Injectable()
export class EaFormService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** Every form for the year, with what is missing. The check screen. */
  async forms(year: number, legalEmployerId?: string, clinicId?: string): Promise<{ year: number; forms: EaForm[]; notApproved: string[] }> {
    const scope = await withScopedAdminTx(this.rawPrisma, 'hr.payroll.export.reports', async (tx, actor, branchScope) => {
      await recordAudit(tx, actor, {
        action: 'payrollReport.served',
        entityType: 'PayrollReport',
        entityId: 'ea-forms',
        after: { year, legalEmployerId: legalEmployerId ?? null, clinicId: clinicId ?? null },
        source: 'hr.payroll',
      });
      return branchScope;
    });
    const people = { staff: scope.where(clinicId) };
    const ytd = await this.prisma.employeeYtd.findMany({
      where: { ...people, taxYear: year, ...(legalEmployerId ? { legalEmployerId } : {}) },
      orderBy: [{ staffId: 'asc' }, { month: 'asc' }],
    });
    const staffIds = [...new Set(ytd.map((row) => row.staffId))];
    const runIds = [...new Set(ytd.map((row) => row.payrollRunId).filter((id): id is string => Boolean(id)))];
    const [staff, employers, snapshots, components, openRuns] = await Promise.all([
      this.prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: {
          id: true,
          fullName: true,
          employeeProfile: {
            select: {
              employeeNo: true,
              legalName: true,
              position: true,
              identifierType: true,
              identifierValue: true,
              passportNumber: true,
              taxNumber: true,
              epfNumber: true,
              socsoNumber: true,
              startDate: true,
              endDate: true,
              qualifyingChildren: true,
            },
          },
        },
      }),
      this.prisma.legalEmployer.findMany({ where: { id: { in: [...new Set(ytd.map((row) => row.legalEmployerId))] } } }),
      this.prisma.payrollSnapshot.findMany({ where: { payrollRunId: { in: runIds } }, orderBy: { version: 'desc' } }),
      this.prisma.payComponent.findMany({ where: { effectiveTo: null } }),
      this.prisma.payrollRun.findMany({
        where: {
          period: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
          status: { in: ['DRAFT', 'CALCULATED'] },
          ...(clinicId ? { clinicId } : {}),
          ...(legalEmployerId ? { OR: [{ legalEmployerId }, { legalEmployerId: null }] } : {}),
        },
        select: { period: true },
      }),
    ]);

    const versionLabel = await this.versionLabel();
    const items = new Map<string, EaItem>(components.map((row) => [row.code, row]));
    // The newest approved version of each month's figures.
    const latest = new Map<string, SnapshotPayload>();
    for (const row of snapshots) if (!latest.has(row.payrollRunId)) latest.set(row.payrollRunId, row.payload as unknown as SnapshotPayload);
    const personOf = new Map(staff.map((row) => [row.id, row]));
    const employerOf = new Map(employers.map((row) => [row.id, row]));

    const groups = new Map<string, typeof ytd>();
    for (const row of ytd) {
      const key = `${row.legalEmployerId}:${row.staffId}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const forms: EaForm[] = [];
    for (const rows of groups.values()) {
      const { staffId, legalEmployerId: employerId } = rows[0];
      const person = personOf.get(staffId);
      const profile = person?.employeeProfile ?? null;
      const employer = employerOf.get(employerId);
      const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);

      const months: EaMonth[] = rows.map((row) => {
        const line = row.payrollRunId ? latest.get(row.payrollRunId)?.employees.find((entry) => entry.staffId === staffId) : undefined;
        const lines = line?.payslip?.componentLines ?? null;
        return { month: row.month, grossCents: row.grossCents, lines: lines && lines.length > 0 ? lines : null };
      });
      const figures = eaFigures(months, items);

      const idNumber = profile?.identifierValue ?? profile?.passportNumber ?? null;
      const problems: EaProblem[] = [];
      if (!profile?.taxNumber) problems.push({ level: 'BLOCK', text: 'No income tax number on the employee record.' });
      if (!idNumber) problems.push({ level: 'BLOCK', text: 'No IC or passport number on the employee record.' });
      if (!employer?.lhdnEmployerNo) problems.push({ level: 'BLOCK', text: `${employer?.name ?? 'The employer'} has no LHDN employer number (E).` });
      if (employer && !employer.phone) problems.push({ level: 'CHECK', text: `${employer.name} has no telephone number to print on the form (Settings → Company & statutory).` });
      if (employer && !employer.eaSignerName) problems.push({ level: 'CHECK', text: `${employer.name} has no EA signing officer to print on the form (Settings → Company & statutory).` });
      if (figures.totalsOnlyMonths.length > 0) {
        problems.push({
          level: 'CHECK',
          text: `${figures.totalsOnlyMonths.map((month) => MONTH[month]).join(', ')}: only the total was kept, so it is all in B1(a). Split it by hand if part was a bonus or allowance.`,
        });
      }
      if (figures.unknownCodes.length > 0) {
        problems.push({ level: 'CHECK', text: `Paid items no longer in Payroll items (${figures.unknownCodes.join(', ')}) were put in B1(a).` });
      }
      if (figures.differenceCents !== 0) {
        problems.push({ level: 'CHECK', text: `The boxes differ from the year's gross pay by RM${formatCents(Math.abs(figures.differenceCents))}.` });
      }

      const addressLines = employer
        ? [[employer.addressLine1, employer.addressLine2].filter(Boolean).join(', '), [[employer.postcode, employer.city].filter(Boolean).join(' '), employer.state].filter(Boolean).join(', ')].filter(Boolean)
        : [];
      forms.push({
        staffId,
        legalEmployerId: employerId,
        year,
        employer: {
          name: employer?.name ?? 'Unknown employer',
          lhdnEmployerNo: employer?.lhdnEmployerNo ?? null,
          address: addressLines.join(', ') || null,
          addressLines,
          phone: employer?.phone ?? null,
          signerName: employer?.eaSignerName ?? null,
          signerPosition: employer?.eaSignerPosition ?? null,
        },
        issueDate: `${year}-12-31`,
        serialNo: '',
        versionLabel,
        labels: figures.labels,
        employee: {
          name: profile?.legalName ?? person?.fullName ?? 'Unknown employee',
          employeeNo: profile?.employeeNo ?? null,
          position: profile?.position ?? null,
          idType: profile?.identifierValue ? (profile.identifierType ?? 'IC') : profile?.passportNumber ? 'PASSPORT' : null,
          idNumber,
          taxNumber: profile?.taxNumber ?? null,
          epfNumber: profile?.epfNumber ?? null,
          socsoNumber: profile?.socsoNumber ?? null,
          startDate: inYear(profile?.startDate ?? null, year),
          endDate: inYear(profile?.endDate ?? null, year),
        },
        boxes: figures.boxes,
        pcbCents: sum((row) => row.pcbCents),
        cp38Cents: sum((row) => row.cp38Cents),
        zakatCents: sum((row) => row.zakatCents),
        tp1ReliefCents: sum((row) => row.deductionsCents),
        qualifyingChildren: profile?.qualifyingChildren ?? 0,
        epfCents: sum((row) => row.epfEmployeeCents),
        socsoCents: sum((row) => row.socsoEmployeeCents + row.eisEmployeeCents),
        status: problems.some((problem) => problem.level === 'BLOCK') ? 'INCOMPLETE' : problems.length > 0 ? 'CHECK' : 'READY',
        problems,
      });
    }

    forms.sort((a, b) => compareByEmployeeName({ name: a.employee.name, staffId: a.staffId }, { name: b.employee.name, staffId: b.staffId }));
    const counters = new Map<string, number>();
    for (const form of forms) {
      const next = (counters.get(form.legalEmployerId) ?? 0) + 1;
      counters.set(form.legalEmployerId, next);
      form.serialNo = `${year}/${String(next).padStart(4, '0')}`;
    }
    const notApproved = [...new Set(openRuns.map((run) => run.period.getUTCMonth() + 1))].sort((a, b) => a - b).map((month) => MONTH[month]);
    return { year, forms, notApproved };
  }

  /** The revision printed on the form; the default until the clinic changes it. */
  async versionLabel(): Promise<string> {
    const row = await this.prisma.globalSetting.findFirst({ where: { key: EA_VERSION_SETTING }, select: { value: true } });
    return typeof row?.value === 'string' && row.value.trim() ? row.value : EA_VERSION_DEFAULT;
  }

  /** Change the revision label, e.g. when LHDN issues "Pin. 2024". The owner's and payroll's call. */
  async setVersionLabel(label: string) {
    const value = label.trim();
    if (value.length < 3 || value.length > 60) throw new BadRequestException('Type the revision as printed on the form, e.g. (C.P.8A - Pin. 2017).');
    return withAdminTx(this.rawPrisma, 'hr.payroll.export.reports', async (tx, actor) => {
      const before = await tx.globalSetting.findFirst({ where: { key: EA_VERSION_SETTING } });
      await tx.globalSetting.upsert({
        where: { tenantId_key: { tenantId: currentTenantId(), key: EA_VERSION_SETTING } },
        create: { tenantId: currentTenantId(), key: EA_VERSION_SETTING, value },
        update: { value },
      });
      await recordAudit(tx, actor, {
        action: 'eaForm.versionChanged',
        entityType: 'GlobalSetting',
        entityId: EA_VERSION_SETTING,
        before: { value: before?.value ?? EA_VERSION_DEFAULT },
        after: { value },
        source: 'hr.payroll',
      });
      return { versionLabel: value };
    });
  }

  /** One person's form. */
  async form(staffId: string, year: number, legalEmployerId?: string): Promise<EaForm> {
    const { forms } = await this.forms(year, legalEmployerId);
    const form = forms.find((row) => row.staffId === staffId);
    if (!form) throw new NotFoundException(`No approved pay in ${year} for this employee.`);
    return form;
  }

  /** Borang E: the employer's yearly return, one block per employer. */
  async borangE(year: number, legalEmployerId?: string, clinicId?: string) {
    const { forms, notApproved } = await this.forms(year, legalEmployerId, clinicId);
    const byEmployer = new Map<string, EaForm[]>();
    for (const form of forms) byEmployer.set(form.legalEmployerId, [...(byEmployer.get(form.legalEmployerId) ?? []), form]);
    const total = (rows: EaForm[], pick: (form: EaForm) => number) => formatCents(rows.reduce((sum, form) => sum + pick(form), 0));
    return {
      year,
      dueDate: `${year + 1}-03-31`,
      notApproved,
      employers: [...byEmployer.values()].map((rows) => ({
        legalEmployerId: rows[0].legalEmployerId,
        name: rows[0].employer.name,
        lhdnEmployerNo: rows[0].employer.lhdnEmployerNo,
        employees: rows.length,
        withTax: rows.filter((form) => form.pcbCents > 0).length,
        incomplete: rows.filter((form) => form.status === 'INCOMPLETE').length,
        remuneration: total(rows, remunerationCents),
        pcb: total(rows, (form) => form.pcbCents),
        cp38: total(rows, (form) => form.cp38Cents),
        zakat: total(rows, (form) => form.zakatCents),
        epf: total(rows, (form) => form.epfCents),
        socso: total(rows, (form) => form.socsoCents),
      })),
    };
  }

  /** The employee listing that goes with Borang E (C.P.8D), as CSV. */
  async cp8dCsv(year: number, legalEmployerId?: string, clinicId?: string) {
    const { forms } = await this.forms(year, legalEmployerId, clinicId);
    const head = [
      'Name',
      'Income tax number',
      'IC or passport number',
      'Employee No.',
      'Gross remuneration (B)',
      'Benefits in kind (B3)',
      'Living accommodation (B4)',
      'Tax-exempt (F)',
      'PCB',
      'CP38',
      'Zakat via salary',
      'EPF (employee)',
      'SOCSO and EIS (employee)',
      'Started',
      'Left',
    ];
    const lines = forms.map((form) =>
      [
        csvCell(form.employee.name),
        csvTextCell(form.employee.taxNumber),
        csvTextCell(form.employee.idNumber),
        csvTextCell(form.employee.employeeNo),
        formatCents(remunerationCents(form)),
        formatCents(form.boxes.B3),
        formatCents(form.boxes.B4),
        formatCents(form.boxes.F),
        formatCents(form.pcbCents),
        formatCents(form.cp38Cents),
        formatCents(form.zakatCents),
        formatCents(form.epfCents),
        formatCents(form.socsoCents),
        form.employee.startDate ?? '',
        form.employee.endDate ?? '',
      ].join(','),
    );
    return { fileName: `cp8d-${year}.csv`, content: CSV_BOM + [head.join(','), ...lines].join('\r\n') + '\r\n' };
  }
}

/** Everything in Part B: the pay LHDN taxes. */
export function remunerationCents(form: Pick<EaForm, 'boxes'>): number {
  return EA_BOXES.filter((box) => box.startsWith('B')).reduce((sum, box) => sum + form.boxes[box], 0);
}

