import { Inject, Injectable } from '@nestjs/common';
import { AppointmentStatus, InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { ClaimBatchService } from '../clinical/claim-batch.service';

/**
 * S3c (D-082) — revenue from a visit with no attending clinician.
 *
 * `Visit.staffId` is nullable now, and these reports group money by doctor.
 * The money is real and must still appear in the totals, so it goes to an
 * explicit bucket rather than being dropped (which would make the report
 * disagree with the ledger) or attributed to whoever registered the patient
 * (which would credit the front desk with a consultation).
 */
const UNASSIGNED_CLINICIAN = 'Attending clinician not assigned';
const UNASSIGNED_CLINICIAN_KEY = '__unassigned__';

export interface ReportDateRange {
  from?: string;
  to?: string;
  clinicId?: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function dateRangeWhere(field: string, range: ReportDateRange) {
  const gte = range.from ? new Date(range.from) : undefined;
  // Inclusive of the whole "to" day.
  const lte = range.to ? new Date(new Date(range.to).setHours(23, 59, 59, 999)) : undefined;
  if (!gte && !lte) return {};
  return { [field]: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } };
}

// Reports & Analytics, Phase 1f — MVP scope only (PRODUCT_REQUIREMENTS.md
// §14): Sales (cash vs panel), Appointment Analytics, Doctor Performance,
// Panel Aging. Doctor Incentives/HR/Inventory/Procurement/Reconciliation/
// Branch-comparison reports stay out of scope until their owning modules
// (1c HR, Phase 2 Inventory) exist to produce that data. Read-only
// aggregation over 1a/1b/1d/1e's existing tables — no new tables of its
// own, matching §9's data-ownership rule that Reports only ever reads.
@Injectable()
export class ReportsService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly claimBatches: ClaimBatchService,
  ) {}

  // "Sales (cash vs. panel)" (§12). cashRevenue is what the clinic actually
  // collected directly from patients (patientPaidAmount — the full total
  // for a self-pay visit, or just the copay for a panel visit);
  // panelRevenue is what panel companies owe (panelCoveredAmount) — same
  // split already snapshotted onto Invoice at pay-time (Phase 1e).
  async getSalesSummary(range: ReportDateRange) {
    const raw = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.PAID,
        ...dateRangeWhere('paidAt', range),
        ...(range.clinicId ? { visit: { clinicId: range.clinicId } } : {}),
      },
      select: { totalAmount: true, patientPaidAmount: true, panelCoveredAmount: true, paidAt: true, paymentMethod: true },
    });

    const totalRevenue = round2(raw.reduce((sum, inv) => sum + Number(inv.totalAmount), 0));
    const cashRevenue = round2(raw.reduce((sum, inv) => sum + Number(inv.patientPaidAmount), 0));
    const panelRevenue = round2(raw.reduce((sum, inv) => sum + Number(inv.panelCoveredAmount), 0));

    const byDayMap = new Map<string, { cash: number; panel: number }>();
    for (const inv of raw) {
      if (!inv.paidAt) continue;
      const day = inv.paidAt.toISOString().slice(0, 10);
      const bucket = byDayMap.get(day) ?? { cash: 0, panel: 0 };
      bucket.cash += Number(inv.patientPaidAmount);
      bucket.panel += Number(inv.panelCoveredAmount);
      byDayMap.set(day, bucket);
    }
    const byDay = Array.from(byDayMap.entries())
      .map(([date, amounts]) => ({ date, cash: round2(amounts.cash), panel: round2(amounts.panel) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const byPaymentMethodMap = new Map<string, number>();
    for (const inv of raw) {
      const method = inv.paymentMethod ?? 'UNKNOWN';
      byPaymentMethodMap.set(method, (byPaymentMethodMap.get(method) ?? 0) + Number(inv.totalAmount));
    }
    const byPaymentMethod = Array.from(byPaymentMethodMap.entries()).map(([paymentMethod, amount]) => ({
      paymentMethod,
      amount: round2(amount),
    }));

    return {
      invoiceCount: raw.length,
      totalRevenue,
      cashRevenue,
      panelRevenue,
      byDay,
      byPaymentMethod,
    };
  }

  // Appointment Analytics (§4): booking volume, no-show rate, utilization
  // proxy (completed / total scheduled).
  async getAppointmentAnalytics(range: ReportDateRange) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        ...dateRangeWhere('scheduledStart', range),
        ...(range.clinicId ? { clinicId: range.clinicId } : {}),
      },
      select: { status: true },
    });

    const total = appointments.length;
    const countByStatus: Record<string, number> = {};
    for (const status of Object.values(AppointmentStatus)) {
      countByStatus[status] = 0;
    }
    for (const appt of appointments) {
      countByStatus[appt.status] += 1;
    }
    const noShowRate = total > 0 ? round2((countByStatus.NO_SHOW / total) * 100) : 0;
    const completedRate = total > 0 ? round2((countByStatus.COMPLETED / total) * 100) : 0;
    const cancelledRate = total > 0 ? round2(((countByStatus.CANCELLED + countByStatus.NO_SHOW) / total) * 100) : 0;

    return { total, countByStatus, noShowRate, completedRate, cancelledRate };
  }

  // Doctor Performance (§4/§12): patients seen, revenue generated, revenue
  // per patient — grouped by the visit's attending staff, over PAID
  // invoices in range.
  async getDoctorPerformance(range: ReportDateRange) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.PAID,
        ...dateRangeWhere('paidAt', range),
        ...(range.clinicId ? { visit: { clinicId: range.clinicId } } : {}),
      },
      select: { totalAmount: true, visit: { select: { staffId: true, staff: { select: { fullName: true } } } } },
    });

    const byStaff = new Map<string, { staffName: string; visitCount: number; revenue: number }>();
    for (const invoice of invoices) {
      const staffId = invoice.visit.staffId ?? UNASSIGNED_CLINICIAN_KEY;
      const bucket = byStaff.get(staffId) ?? {
        staffName: invoice.visit.staff?.fullName ?? UNASSIGNED_CLINICIAN,
        visitCount: 0,
        revenue: 0,
      };
      bucket.visitCount += 1;
      bucket.revenue += Number(invoice.totalAmount);
      byStaff.set(staffId, bucket);
    }

    return Array.from(byStaff.entries())
      .map(([staffId, bucket]) => ({
        staffId,
        staffName: bucket.staffName,
        visitCount: bucket.visitCount,
        revenue: round2(bucket.revenue),
        revenuePerVisit: bucket.visitCount > 0 ? round2(bucket.revenue / bucket.visitCount) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  // Panel Claims & Aging (§12) — reuses ClaimBatchService's own outstanding
  // computation rather than duplicating it, so the aging rule can never
  // drift between the Panel Claims screen and this dashboard.
  getPanelAging() {
    return this.claimBatches.listOutstanding();
  }

  // ---------------------------------------------------------------------
  // Report suite (D-039) — built to the owner's own Power BI file
  // (docs/PROPOSED_ADDENDUM_2026-07-31_powerbi-report-reference.md). All
  // read-only aggregation over PAID invoices / visits, same as above.
  // ---------------------------------------------------------------------

  // Revenue category, matching the reference's CONSULTATION / DRUGS /
  // SERVICES / OTHERS split. Heuristic by line provenance: a line pulled
  // from a Prescription is Drugs, from an OrderService is Services, a
  // description containing "consult" is Consultation, anything else Others.
  private categorizeLine(line: { sourcePrescriptionId: string | null; sourceOrderServiceId: string | null; description: string }): string {
    if (line.sourcePrescriptionId) return 'Drugs';
    if (line.sourceOrderServiceId) return 'Services';
    if (/consult/i.test(line.description)) return 'Consultation';
    return 'Others';
  }

  private paidInvoicesWhere(range: ReportDateRange) {
    return {
      status: InvoiceStatus.PAID,
      ...dateRangeWhere('paidAt', range),
      ...(range.clinicId ? { visit: { clinicId: range.clinicId } } : {}),
    };
  }

  // Day-End Closing — the owner's "closing that day" summary: total sales,
  // panel vs cash patients, cash collections split by payment method,
  // panel billings split by panel company with patient counts.
  async getDayEndSummary(clinicId: string | undefined, date: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: this.paidInvoicesWhere({ from: date, to: date, clinicId }),
      select: {
        totalAmount: true,
        patientPaidAmount: true,
        panelCoveredAmount: true,
        paymentMethod: true,
        visit: { select: { billingType: true, panelClinic: { select: { name: true } } } },
      },
    });

    let totalSales = 0;
    let cashCollected = 0;
    let panelBilled = 0;
    let panelPatients = 0;
    let cashPatients = 0;
    const byPaymentMethod = new Map<string, { amount: number; count: number }>();
    const byPanel = new Map<string, { amount: number; patients: number }>();

    for (const invoice of invoices) {
      totalSales += Number(invoice.totalAmount);
      cashCollected += Number(invoice.patientPaidAmount);
      panelBilled += Number(invoice.panelCoveredAmount);
      const isPanel = Number(invoice.panelCoveredAmount) > 0 || !!invoice.visit.panelClinic;
      if (isPanel) {
        panelPatients += 1;
        const panelName = invoice.visit.panelClinic?.name ?? invoice.visit.billingType;
        const bucket = byPanel.get(panelName) ?? { amount: 0, patients: 0 };
        bucket.amount += Number(invoice.panelCoveredAmount);
        bucket.patients += 1;
        byPanel.set(panelName, bucket);
      } else {
        cashPatients += 1;
      }
      // Payment method applies to what the patient paid at the counter.
      if (Number(invoice.patientPaidAmount) > 0) {
        const method = invoice.paymentMethod ?? 'UNKNOWN';
        const bucket = byPaymentMethod.get(method) ?? { amount: 0, count: 0 };
        bucket.amount += Number(invoice.patientPaidAmount);
        bucket.count += 1;
        byPaymentMethod.set(method, bucket);
      }
    }

    const unpaidCount = await this.prisma.invoice.count({
      where: {
        status: InvoiceStatus.UNPAID,
        ...dateRangeWhere('createdAt', { from: date, to: date }),
        ...(clinicId ? { visit: { clinicId } } : {}),
      },
    });

    return {
      date,
      invoiceCount: invoices.length,
      totalSales: round2(totalSales),
      cashCollected: round2(cashCollected),
      panelBilled: round2(panelBilled),
      cashPatients,
      panelPatients,
      unpaidCount,
      byPaymentMethod: Array.from(byPaymentMethod.entries()).map(([paymentMethod, bucket]) => ({
        paymentMethod,
        amount: round2(bucket.amount),
        count: bucket.count,
      })),
      byPanel: Array.from(byPanel.entries())
        .map(([panelName, bucket]) => ({ panelName, amount: round2(bucket.amount), patients: bucket.patients }))
        .sort((a, b) => b.amount - a.amount),
    };
  }

  // Sales Analysis — the reference's SALES ANALYSIS pages: panel vs
  // non-panel sales, revenue by category, % of sales by doctor / by panel
  // company, average charge per patient (overall / panel / non-panel),
  // daily trend of sales + patient count.
  async getSalesAnalysis(range: ReportDateRange) {
    const invoices = await this.prisma.invoice.findMany({
      where: this.paidInvoicesWhere(range),
      select: {
        totalAmount: true,
        patientPaidAmount: true,
        panelCoveredAmount: true,
        paidAt: true,
        lines: { select: { amount: true, description: true, sourcePrescriptionId: true, sourceOrderServiceId: true } },
        visit: {
          select: {
            staff: { select: { fullName: true } },
            panelClinic: { select: { name: true } },
          },
        },
      },
    });

    let totalSales = 0;
    let panelSales = 0;
    let nonPanelSales = 0;
    let panelInvoices = 0;
    let nonPanelInvoices = 0;
    const byCategory = new Map<string, number>();
    const byDoctor = new Map<string, number>();
    const byPanel = new Map<string, number>();
    const byDay = new Map<string, { sales: number; patients: number }>();

    for (const invoice of invoices) {
      const total = Number(invoice.totalAmount);
      totalSales += total;
      const isPanel = Number(invoice.panelCoveredAmount) > 0 || !!invoice.visit.panelClinic;
      if (isPanel) {
        panelSales += total;
        panelInvoices += 1;
        const panelName = invoice.visit.panelClinic?.name ?? 'Panel';
        byPanel.set(panelName, (byPanel.get(panelName) ?? 0) + total);
      } else {
        nonPanelSales += total;
        nonPanelInvoices += 1;
      }
      const doctor = invoice.visit.staff?.fullName ?? UNASSIGNED_CLINICIAN;
      byDoctor.set(doctor, (byDoctor.get(doctor) ?? 0) + total);
      for (const line of invoice.lines) {
        const category = this.categorizeLine(line);
        byCategory.set(category, (byCategory.get(category) ?? 0) + Number(line.amount));
      }
      if (invoice.paidAt) {
        const day = invoice.paidAt.toISOString().slice(0, 10);
        const bucket = byDay.get(day) ?? { sales: 0, patients: 0 };
        bucket.sales += total;
        bucket.patients += 1;
        byDay.set(day, bucket);
      }
    }

    return {
      totalSales: round2(totalSales),
      panelSales: round2(panelSales),
      nonPanelSales: round2(nonPanelSales),
      averageChargePerPatient: invoices.length > 0 ? round2(totalSales / invoices.length) : 0,
      averageChargePerPanelPatient: panelInvoices > 0 ? round2(panelSales / panelInvoices) : 0,
      averageChargePerNonPanelPatient: nonPanelInvoices > 0 ? round2(nonPanelSales / nonPanelInvoices) : 0,
      byCategory: Array.from(byCategory.entries()).map(([category, amount]) => ({ category, amount: round2(amount) })),
      byDoctor: Array.from(byDoctor.entries())
        .map(([doctorName, amount]) => ({ doctorName, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount),
      byPanel: Array.from(byPanel.entries())
        .map(([panelName, amount]) => ({ panelName, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount),
      byDay: Array.from(byDay.entries())
        .map(([date, bucket]) => ({ date, sales: round2(bucket.sales), patients: bucket.patients }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // Patient Analysis — the reference's PATIENT ANALYSIS page: new vs
  // existing, panel vs non-panel, gender, age group, % by panel,
  // attendance by hour and by day of week. Visit-grain over checkInAt.
  async getPatientAnalysis(range: ReportDateRange) {
    const visits = await this.prisma.visit.findMany({
      where: {
        ...dateRangeWhere('checkInAt', range),
        ...(range.clinicId ? { clinicId: range.clinicId } : {}),
      },
      select: {
        checkInAt: true,
        patientId: true,
        panelClinicId: true,
        panelClinic: { select: { name: true } },
        patient: { select: { dob: true, gender: true, createdAt: true } },
      },
    });

    const rangeStart = range.from ? new Date(range.from) : null;
    let newPatients = 0;
    let existingPatients = 0;
    let panelVisits = 0;
    let cashVisits = 0;
    const byGender = new Map<string, number>();
    const byAgeGroup = new Map<string, number>();
    const byPanel = new Map<string, number>();
    const byHour = new Map<number, number>();
    const byDayOfWeek = new Map<string, number>();
    const seenPatients = new Set<string>();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const visit of visits) {
      // "New" = the patient record itself was created inside the range —
      // a first-ever registration, not merely their first visit this month.
      if (!seenPatients.has(visit.patientId)) {
        seenPatients.add(visit.patientId);
        if (rangeStart && visit.patient.createdAt >= rangeStart) newPatients += 1;
        else existingPatients += 1;
      }
      if (visit.panelClinicId) {
        panelVisits += 1;
        byPanel.set(visit.panelClinic?.name ?? 'Panel', (byPanel.get(visit.panelClinic?.name ?? 'Panel') ?? 0) + 1);
      } else {
        cashVisits += 1;
      }
      const gender = visit.patient.gender ?? 'Unknown';
      byGender.set(gender, (byGender.get(gender) ?? 0) + 1);
      const ageGroup = ageGroupOf(visit.patient.dob, visit.checkInAt);
      byAgeGroup.set(ageGroup, (byAgeGroup.get(ageGroup) ?? 0) + 1);
      byHour.set(visit.checkInAt.getHours(), (byHour.get(visit.checkInAt.getHours()) ?? 0) + 1);
      const dayName = dayNames[visit.checkInAt.getDay()];
      byDayOfWeek.set(dayName, (byDayOfWeek.get(dayName) ?? 0) + 1);
    }

    return {
      totalVisits: visits.length,
      uniquePatients: seenPatients.size,
      newPatients,
      existingPatients,
      panelVisits,
      cashVisits,
      byGender: Array.from(byGender.entries()).map(([gender, count]) => ({ gender, count })),
      byAgeGroup: Array.from(byAgeGroup.entries())
        .map(([ageGroup, count]) => ({ ageGroup, count }))
        .sort((a, b) => AGE_GROUP_ORDER.indexOf(a.ageGroup) - AGE_GROUP_ORDER.indexOf(b.ageGroup)),
      byPanel: Array.from(byPanel.entries())
        .map(([panelName, count]) => ({ panelName, count }))
        .sort((a, b) => b.count - a.count),
      byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour) ?? 0 })),
      byDayOfWeek: dayNames.map((day) => ({ day, count: byDayOfWeek.get(day) ?? 0 })),
    };
  }

  // Procedure Analysis — the reference's PROCEDURE ANALYSIS page: revenue
  // and count by charge description and by charge-description group
  // (ServiceCatalog.category), over PAID invoice lines sourced from
  // OrderServices.
  async getProcedureAnalysis(range: ReportDateRange) {
    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        sourceOrderServiceId: { not: null },
        invoice: this.paidInvoicesWhere(range),
      },
      select: {
        description: true,
        amount: true,
        sourceOrderService: {
          select: { serviceCatalog: { select: { category: true } }, requestedBy: { select: { fullName: true } } },
        },
      },
    });

    const byDescription = new Map<string, { revenue: number; count: number }>();
    const byGroup = new Map<string, { revenue: number; count: number }>();
    const byDoctor = new Map<string, number>();
    let totalRevenue = 0;

    for (const line of lines) {
      totalRevenue += Number(line.amount);
      const description = line.description;
      const descBucket = byDescription.get(description) ?? { revenue: 0, count: 0 };
      descBucket.revenue += Number(line.amount);
      descBucket.count += 1;
      byDescription.set(description, descBucket);
      const group = line.sourceOrderService?.serviceCatalog?.category ?? 'Uncategorised';
      const groupBucket = byGroup.get(group) ?? { revenue: 0, count: 0 };
      groupBucket.revenue += Number(line.amount);
      groupBucket.count += 1;
      byGroup.set(group, groupBucket);
      const doctor = line.sourceOrderService?.requestedBy?.fullName ?? 'Unassigned';
      byDoctor.set(doctor, (byDoctor.get(doctor) ?? 0) + Number(line.amount));
    }

    const toSorted = (map: Map<string, { revenue: number; count: number }>, key: string) =>
      Array.from(map.entries())
        .map(([name, bucket]) => ({ [key]: name, revenue: round2(bucket.revenue), count: bucket.count }))
        .sort((a, b) => (b.revenue as number) - (a.revenue as number));

    return {
      totalRevenue: round2(totalRevenue),
      lineCount: lines.length,
      byDescription: toSorted(byDescription, 'description'),
      byGroup: toSorted(byGroup, 'group'),
      byDoctor: Array.from(byDoctor.entries())
        .map(([doctorName, revenue]) => ({ doctorName, revenue: round2(revenue) }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }

  // Doctor Performance (extended, D-039) — adds the reference's per-doctor
  // Consultation/Drugs/Services/Others revenue split and average charge.
  // The reference's per-doctor SCORE is a DAX measure whose formula is not
  // recoverable from the report layout — deliberately not invented (same
  // treatment as OQ#2's incentive formula).
  async getDoctorPerformanceDetailed(range: ReportDateRange) {
    const invoices = await this.prisma.invoice.findMany({
      where: this.paidInvoicesWhere(range),
      select: {
        totalAmount: true,
        lines: { select: { amount: true, description: true, sourcePrescriptionId: true, sourceOrderServiceId: true } },
        visit: { select: { staffId: true, staff: { select: { fullName: true } } } },
      },
    });

    interface DoctorBucket {
      staffName: string;
      patients: number;
      sales: number;
      categories: Map<string, number>;
    }
    const byStaff = new Map<string, DoctorBucket>();
    for (const invoice of invoices) {
      const bucket = byStaff.get(invoice.visit.staffId ?? UNASSIGNED_CLINICIAN_KEY) ?? {
        staffName: invoice.visit.staff?.fullName ?? UNASSIGNED_CLINICIAN,
        patients: 0,
        sales: 0,
        categories: new Map<string, number>(),
      };
      bucket.patients += 1;
      bucket.sales += Number(invoice.totalAmount);
      for (const line of invoice.lines) {
        const category = this.categorizeLine(line);
        bucket.categories.set(category, (bucket.categories.get(category) ?? 0) + Number(line.amount));
      }
      byStaff.set(invoice.visit.staffId ?? UNASSIGNED_CLINICIAN_KEY, bucket);
    }

    return Array.from(byStaff.entries())
      .map(([staffId, bucket]) => ({
        staffId,
        staffName: bucket.staffName,
        patients: bucket.patients,
        sales: round2(bucket.sales),
        consultationRevenue: round2(bucket.categories.get('Consultation') ?? 0),
        drugsRevenue: round2(bucket.categories.get('Drugs') ?? 0),
        servicesRevenue: round2(bucket.categories.get('Services') ?? 0),
        othersRevenue: round2(bucket.categories.get('Others') ?? 0),
        averageChargePerPatient: bucket.patients > 0 ? round2(bucket.sales / bucket.patients) : 0,
      }))
      .sort((a, b) => b.sales - a.sales);
  }

  // Drug movement (D-042, owner requirement "drug revenue — fast moving vs
  // slow moving") — dispensed-drug sales over PAID invoice lines sourced
  // from Prescriptions, including never-sold items so slow movers surface.
  async getDrugMovement(range: ReportDateRange) {
    const [lines, items] = await Promise.all([
      this.prisma.invoiceLine.findMany({
        where: {
          sourcePrescriptionId: { not: null },
          invoice: this.paidInvoicesWhere(range),
        },
        select: {
          quantity: true,
          amount: true,
          sourcePrescription: { select: { itemId: true, item: { select: { name: true, category: true } } } },
        },
      }),
      this.prisma.item.findMany({ select: { id: true, name: true, category: true } }),
    ]);

    const byItem = new Map<string, { name: string; category: string | null; quantity: number; revenue: number; prescriptions: number }>();
    for (const line of lines) {
      const itemId = line.sourcePrescription?.itemId;
      if (!itemId) continue;
      const bucket = byItem.get(itemId) ?? {
        name: line.sourcePrescription!.item.name,
        category: line.sourcePrescription!.item.category,
        quantity: 0,
        revenue: 0,
        prescriptions: 0,
      };
      bucket.quantity += line.quantity;
      bucket.revenue += Number(line.amount);
      bucket.prescriptions += 1;
      byItem.set(itemId, bucket);
    }

    const sold = Array.from(byItem.entries())
      .map(([itemId, bucket]) => ({
        itemId,
        name: bucket.name,
        category: bucket.category,
        quantity: bucket.quantity,
        revenue: round2(bucket.revenue),
        prescriptions: bucket.prescriptions,
      }))
      .sort((a, b) => b.quantity - a.quantity);

    const soldIds = new Set(sold.map((row) => row.itemId));
    const neverSold = items
      .filter((item) => !soldIds.has(item.id))
      .map((item) => ({
        itemId: item.id,
        name: item.name,
        category: item.category,
        quantity: 0,
        revenue: 0,
        prescriptions: 0,
      }));

    return [
      ...sold.map((row, index) => ({ ...row, movement: classifyMovement(index, sold.length) })),
      ...neverSold.map((row) => ({ ...row, movement: 'SLOW' as const })),
    ];
  }

  // Waiting-time analysis (D-042, owner requirement "waiting-consultation-
  // dispensary time") — from the timestamps the system already records:
  // queue-ticket creation → called (waiting), called → check-out
  // (consultation + dispensary), check-in → check-out (total visit).
  async getWaitTimes(range: ReportDateRange) {
    const visits = await this.prisma.visit.findMany({
      where: {
        ...dateRangeWhere('checkInAt', range),
        ...(range.clinicId ? { clinicId: range.clinicId } : {}),
      },
      select: {
        checkInAt: true,
        checkOutAt: true,
        queueTicket: { select: { createdAt: true, calledAt: true } },
      },
    });

    const MAX_SANE_MINUTES = 8 * 60; // guard against forgotten check-outs skewing averages
    const waitSamples: number[] = [];
    const serviceSamples: number[] = [];
    const totalSamples: number[] = [];
    const byDay = new Map<string, { waitSum: number; waitCount: number; serviceSum: number; serviceCount: number }>();
    const buckets = { '0-15 min': 0, '15-30 min': 0, '30-60 min': 0, '60+ min': 0 };

    const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60000);

    for (const visit of visits) {
      const ticket = visit.queueTicket;
      const day = visit.checkInAt.toISOString().slice(0, 10);
      if (ticket?.calledAt) {
        const wait = minutesBetween(ticket.createdAt, ticket.calledAt);
        if (wait >= 0 && wait <= MAX_SANE_MINUTES) {
          waitSamples.push(wait);
          if (wait < 15) buckets['0-15 min'] += 1;
          else if (wait < 30) buckets['15-30 min'] += 1;
          else if (wait < 60) buckets['30-60 min'] += 1;
          else buckets['60+ min'] += 1;
          const dayBucket = byDay.get(day) ?? { waitSum: 0, waitCount: 0, serviceSum: 0, serviceCount: 0 };
          dayBucket.waitSum += wait;
          dayBucket.waitCount += 1;
          byDay.set(day, dayBucket);
        }
        if (visit.checkOutAt) {
          const service = minutesBetween(ticket.calledAt, visit.checkOutAt);
          if (service >= 0 && service <= MAX_SANE_MINUTES) {
            serviceSamples.push(service);
            const dayBucket = byDay.get(day) ?? { waitSum: 0, waitCount: 0, serviceSum: 0, serviceCount: 0 };
            dayBucket.serviceSum += service;
            dayBucket.serviceCount += 1;
            byDay.set(day, dayBucket);
          }
        }
      }
      if (visit.checkOutAt) {
        const total = minutesBetween(visit.checkInAt, visit.checkOutAt);
        if (total >= 0 && total <= MAX_SANE_MINUTES) totalSamples.push(total);
      }
    }

    const average = (samples: number[]) =>
      samples.length > 0 ? round2(samples.reduce((sum, value) => sum + value, 0) / samples.length) : null;

    return {
      visitCount: visits.length,
      measuredWaits: waitSamples.length,
      averageWaitMinutes: average(waitSamples),
      averageServiceMinutes: average(serviceSamples),
      averageTotalVisitMinutes: average(totalSamples),
      waitBuckets: Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })),
      byDay: Array.from(byDay.entries())
        .map(([date, bucket]) => ({
          date,
          averageWaitMinutes: bucket.waitCount > 0 ? round2(bucket.waitSum / bucket.waitCount) : null,
          averageServiceMinutes: bucket.serviceCount > 0 ? round2(bucket.serviceSum / bucket.serviceCount) : null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // Invoice / sales listing with status filter — feeds the exportable
  // Invoices table.
  async getInvoiceListing(range: ReportDateRange, status?: InvoiceStatus) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...dateRangeWhere(status === InvoiceStatus.PAID ? 'paidAt' : 'createdAt', range),
        ...(range.clinicId ? { visit: { clinicId: range.clinicId } } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        patientPaidAmount: true,
        panelCoveredAmount: true,
        paymentMethod: true,
        paidAt: true,
        createdAt: true,
        visit: {
          select: {
            billingType: true,
            patient: { select: { name: true } },
            staff: { select: { fullName: true } },
            panelClinic: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      patientName: invoice.visit.patient.name,
      doctorName: invoice.visit.staff?.fullName ?? UNASSIGNED_CLINICIAN,
      billingType: invoice.visit.billingType,
      panelName: invoice.visit.panelClinic?.name ?? null,
      totalAmount: Number(invoice.totalAmount),
      patientPaidAmount: Number(invoice.patientPaidAmount),
      panelCoveredAmount: Number(invoice.panelCoveredAmount),
      paymentMethod: invoice.paymentMethod,
      paidAt: invoice.paidAt,
      createdAt: invoice.createdAt,
    }));
  }
}

const AGE_GROUP_ORDER = ['0-12', '13-17', '18-39', '40-59', '60+', 'Unknown'];

// Fast/slow classification: top third of sold items by quantity = FAST,
// bottom third (plus never-sold items) = SLOW, middle = MEDIUM. A simple
// tertile rule — deliberately explainable to a clinic owner at a glance.
export function classifyMovement(rankIndex: number, soldCount: number): 'FAST' | 'MEDIUM' | 'SLOW' {
  if (soldCount === 0) return 'SLOW';
  const tertile = soldCount / 3;
  if (rankIndex < tertile) return 'FAST';
  if (rankIndex >= soldCount - tertile) return 'SLOW';
  return 'MEDIUM';
}

function ageGroupOf(dob: Date | null, atDate: Date): string {
  if (!dob) return 'Unknown';
  const age = Math.floor((atDate.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (age <= 12) return '0-12';
  if (age <= 17) return '13-17';
  if (age <= 39) return '18-39';
  if (age <= 59) return '40-59';
  return '60+';
}
