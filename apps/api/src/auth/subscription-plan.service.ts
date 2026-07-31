import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

// Platform console (D-037) — subscription_plans has no RLS at all (like
// platform_admins), so plain PrismaService needs no bypass GUC here.
@Injectable()
export class SubscriptionPlanService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSubscriptionPlanDto) {
    return this.prisma.subscriptionPlan.create({ data: dto });
  }

  findAll() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async findById(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }
    return plan;
  }

  async update(id: string, dto: UpdateSubscriptionPlanDto) {
    await this.findById(id);
    return this.prisma.subscriptionPlan.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findById(id);
    try {
      await this.prisma.subscriptionPlan.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('This plan has tenant subscriptions attached and cannot be deleted — deactivate it instead');
      }
      throw error;
    }
  }
}
