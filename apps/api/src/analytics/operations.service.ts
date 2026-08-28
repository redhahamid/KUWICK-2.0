import { Inject, Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission } from '../finance/admin-actor';
import { fromCents, toCents } from '../finance/money';

export type PeriodPreset = 'TODAY' | 'MONTH' | 'QUARTER' | 'CUSTOM';

/** Resolves the four periods the brief names, in UTC, as [from, to). */
export function resolvePeriod(preset: PeriodPreset, from?: string, to?: string, now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (preset) {
    case 'TODAY':
      return { from: day, to: new Date(day.getTime() + 86400000), label: 'Today' };
    case 'MONTH':
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
        label: 'This month',
      };
    case 'QUARTER': {
      const quarterStart = Math.floor(now.getUTCMonth() / 3) * 3;
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), quarterStart, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), quarterStart + 3, 1)),
        label: 'This quarter',
      };
    }
    default:
      return {
        from: new Date(`${from ?? day.toISOString().slice(0, 10)}T00:00:00.000Z`),
        to: new Date(new Date(`${to ?? day.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime() + 86400000),
        label: `${from} to ${to}`,
      };
  }
}

/**
 * OPERATIONS — "how is the clinic performing?"
 *
 * The one thing this module is careful about beyond arithmetic: DOCTOR
 * PRODUCTIVITY IS NOT DOCTOR INCOME. The brief is explicit — "Never imply
 * revenue = doctor income" — so the doctor rows are labelled `billedUnderDoctor`
 * and the payload carries the sentence saying what that is and is not.
 */
@Injectable()
export class OperationsService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async overview(params: { clinicId?: string; preset?: PeriodPreset; from?: string; to?: string }) {
    const actor = await requirePermission(this.rawPrisma, 'analytics.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const period = resolvePeriod(params.preset ?? 'MONTH', params.from, params.to);
    const clinicFilter = clinicId ? { clinicId } : {};

    const visits = await this.prisma.visit.findMany({
      where: { ...clinicFilter, createdAt: { gte: period.from, lt: period.to } },
      select: {
        id: true,
        patientId: true,
        createdAt: true,
        checkInAt: true,
        billingType: true,
        staffId: true,
        panelClinicId: true,
        appointment: { select: { id: true } },
        staff: { select: { id: true, fullName: true } },
        queueTicket: { select: { calledAt: true, status: true } },
        invoices: {
          where: { status: { not: InvoiceStatus.CANCELLED } },
          select: { id: true, totalAmount: true, patientResponsibilityAmount: true, panelResponsibilityAmount: true },
        },
      },
    });

    // NEW vs RETURNING, measured against the patient's FIRST visit ever, not
    // against the period — a patient registered last year who returns today is
    // returning, however the period is drawn.
    const patientIds = [...new Set(visits.map((visit) => visit.patientId))];
    const firstVisits = await this.prisma.visit.groupBy({
      by: ['patientId'],
      where: { patientId: { in: patientIds } },
      _min: { createdAt: true },
    });
    const firstById = new Map(firstVisits.map((row) => [row.patientId, row._min.createdAt]));

    let newPatients = 0;
    let returningPatients = 0;
    for (const patientId of patientIds) {
      const first = firstById.get(patientId);
      if (first && first >= period.from) newPatients += 1;
      else returningPatients += 1;
    }

    let revenueCents = 0;
    let panelCents = 0;
    const byDay = new Map<string, { visits: number; revenueCents: number }>();
    const byHour = new Array(24).fill(0);
    const byDoctor = new Map<string, { name: string; visits: number; billedCents: number }>();
    const bySource = { appointment: 0, walkIn: 0 };
    const waits: number[] = [];

    for (const visit of visits) {
      const visitRevenue = visit.invoices.reduce((total, invoice) => total + toCents(invoice.totalAmount), 0);
      revenueCents += visitRevenue;
      panelCents += visit.invoices.reduce(
        (total, invoice) => total + toCents(invoice.panelResponsibilityAmount ?? 0),
        0,
      );

      const dayKey = visit.createdAt.toISOString().slice(0, 10);
      const dayBucket = byDay.get(dayKey) ?? { visits: 0, revenueCents: 0 };
      dayBucket.visits += 1;
      dayBucket.revenueCents += visitRevenue;
      byDay.set(dayKey, dayBucket);

      byHour[visit.createdAt.getUTCHours()] += 1;

      if (visit.staffId && visit.staff) {
        const doctorBucket = byDoctor.get(visit.staffId) ?? { name: visit.staff.fullName, visits: 0, billedCents: 0 };
        doctorBucket.visits += 1;
        doctorBucket.billedCents += visitRevenue;
        byDoctor.set(visit.staffId, doctorBucket);
      }

      if (visit.appointment) bySource.appointment += 1;
      else bySource.walkIn += 1;

      // WAIT TIME, only where both instants exist. A visit missing either is
      // excluded from the average rather than counted as a zero wait, which
      // would drag the clinic's headline number down for a data gap.
      if (visit.checkInAt && visit.queueTicket?.calledAt) {
        waits.push(Math.round((visit.queueTicket.calledAt.getTime() - visit.checkInAt.getTime()) / 60000));
      }
    }

    const averageWait =
      waits.length === 0 ? null : Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);

    return {
      period: { label: period.label, from: period.from.toISOString().slice(0, 10), to: new Date(period.to.getTime() - 1).toISOString().slice(0, 10) },
      clinicId: clinicId ?? null,
      kpis: {
        visits: visits.length,
        patients: patientIds.length,
        newPatients,
        returningPatients,
        revenue: fromCents(revenueCents),
        panelPortion: fromCents(panelCents),
        averageBillPerPatient: patientIds.length === 0 ? 0 : fromCents(Math.round(revenueCents / patientIds.length)),
        averageWaitMinutes: averageWait,
        waitSampleSize: waits.length,
        waitCoverage:
          visits.length === 0 ? null : Math.round((waits.length / visits.length) * 1000) / 10,
      },
      source: bySource,
      byDay: [...byDay.entries()]
        .map(([date, bucket]) => ({ date, visits: bucket.visits, revenue: fromCents(bucket.revenueCents) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byHour: byHour.map((count, hour) => ({ hour, visits: count })),
      // The label and the caveat travel together, so no screen can render the
      // number without the sentence.
      doctorProductivityNote:
        'Billed under doctor is the value of invoices raised on visits this doctor attended. It is NOT the doctor’s income, NOT their commission, and includes charges (medication, procedures, panel share) they do not personally earn.',
      byDoctor: [...byDoctor.entries()]
        .map(([staffId, bucket]) => ({
          staffId,
          name: bucket.name,
          visits: bucket.visits,
          billedUnderDoctor: fromCents(bucket.billedCents),
          averageBillPerVisit: bucket.visits === 0 ? 0 : fromCents(Math.round(bucket.billedCents / bucket.visits)),
        }))
        .sort((a, b) => b.billedUnderDoctor - a.billedUnderDoctor),
    };
  }
}
