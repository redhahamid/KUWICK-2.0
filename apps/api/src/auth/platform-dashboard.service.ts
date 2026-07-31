import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';

const EXPIRING_SOON_DAYS = 7;

// Platform console (D-037) — the "Super Admin Dashboard" reference screen:
// active-clinic count, active subscriptions, estimated monthly revenue,
// recent signups, expiring-soon list, and plan distribution.
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async withBypass<T>(fn: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return fn(tx);
    });
  }

  async getSummary() {
    return this.withBypass(async (tx) => {
      const now = new Date();
      const soon = new Date();
      soon.setDate(soon.getDate() + EXPIRING_SOON_DAYS);

      const [totalActiveClinics, activeSubscriptions, recentSignups, expiringSoon] = await Promise.all([
        tx.tenant.count({ where: { status: 'active' } }),
        tx.tenantSubscription.findMany({
          where: { status: { in: ['ACTIVE', 'TRIAL'] }, endsAt: { gt: now } },
          include: { plan: true, tenant: true },
        }),
        tx.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
        tx.tenantSubscription.findMany({
          where: { status: { in: ['ACTIVE', 'TRIAL'] }, endsAt: { gt: now, lte: soon } },
          include: { tenant: true, plan: true },
          orderBy: { endsAt: 'asc' },
        }),
      ]);

      // Estimated monthly revenue: each active paid subscription's plan
      // price normalised to a 30-day month (a 30-day RM100 plan counts
      // RM100/month; a 90-day plan counts a third of its price).
      const monthlyRevenueEstimate = activeSubscriptions.reduce((sum, subscription) => {
        if (!subscription.plan) return sum;
        const price = Number(subscription.plan.priceMyr);
        return sum + (price / subscription.plan.durationDays) * 30;
      }, 0);

      const planDistribution = new Map<string, number>();
      for (const subscription of activeSubscriptions) {
        const name = subscription.plan?.name ?? 'Trial (no plan)';
        planDistribution.set(name, (planDistribution.get(name) ?? 0) + 1);
      }

      return {
        totalActiveClinics,
        activeSubscriptionCount: activeSubscriptions.length,
        monthlyRevenueEstimate: Math.round(monthlyRevenueEstimate * 100) / 100,
        recentSignups: recentSignups.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          createdAt: tenant.createdAt,
        })),
        expiringSoon: expiringSoon.map((subscription) => ({
          id: subscription.id,
          tenantName: subscription.tenant.name,
          planName: subscription.plan?.name ?? 'Trial',
          endsAt: subscription.endsAt,
        })),
        planDistribution: Array.from(planDistribution.entries()).map(([name, count]) => ({ name, count })),
      };
    });
  }
}
