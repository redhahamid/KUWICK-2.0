import { Inject, Injectable } from '@nestjs/common';
import { AppointmentStatus, InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { ClaimBatchService } from '../clinical/claim-batch.service';

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
      const staffId = invoice.visit.staffId;
      const bucket = byStaff.get(staffId) ?? {
        staffName: invoice.visit.staff.fullName,
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
}
