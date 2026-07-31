import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { ExtendSubscriptionDto } from './dto/extend-subscription.dto';

// Platform console (D-037) — tenant_subscriptions carries the ordinary
// tenant_isolation RLS policy (tenantId = app.tenant_id), same as every
// other tenant-scoped table; the platform console bypasses it with
// app.bypass_tenant_scope (migration 20260731280000, D-036), exactly like
// PlatformTenantService does for the tenants table itself.
@Injectable()
export class TenantSubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  private async withBypass<T>(fn: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return fn(tx);
    });
  }

  // One row per tenant — its most recent subscription — matching the
  // owner's "All Tenant Subscriptions" reference screen (not a full history
  // list).
  findAll() {
    return this.withBypass((tx) =>
      tx.tenantSubscription.findMany({
        distinct: ['tenantId'],
        orderBy: [{ tenantId: 'asc' }, { createdAt: 'desc' }],
        include: { tenant: true, plan: true },
      }),
    );
  }

  async activate(dto: ActivateSubscriptionDto) {
    return this.withBypass(async (tx) => {
      const plan = await tx.subscriptionPlan.findUnique({ where: { id: dto.planId } });
      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }
      const tenant = await tx.tenant.findUnique({ where: { id: dto.tenantId } });
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }

      const durationDays = dto.durationDays ?? plan.durationDays;
      const endsAt = new Date();
      endsAt.setDate(endsAt.getDate() + durationDays);

      return tx.tenantSubscription.create({
        data: { tenantId: dto.tenantId, planId: dto.planId, status: 'ACTIVE', endsAt },
        include: { tenant: true, plan: true },
      });
    });
  }

  async extend(id: string, dto: ExtendSubscriptionDto) {
    return this.withBypass(async (tx) => {
      const subscription = await tx.tenantSubscription.findUnique({ where: { id } });
      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }
      const endsAt = new Date(subscription.endsAt);
      endsAt.setDate(endsAt.getDate() + dto.extraDays);
      return tx.tenantSubscription.update({
        where: { id },
        data: { endsAt, status: subscription.status === 'CANCELLED' ? 'ACTIVE' : subscription.status },
        include: { tenant: true, plan: true },
      });
    });
  }

  async cancel(id: string) {
    return this.withBypass(async (tx) => {
      const subscription = await tx.tenantSubscription.findUnique({ where: { id } });
      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }
      if (subscription.status === 'CANCELLED') {
        throw new BadRequestException('Subscription is already cancelled');
      }
      return tx.tenantSubscription.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
        include: { tenant: true, plan: true },
      });
    });
  }
}
