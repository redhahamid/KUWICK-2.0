import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

// "Manually Activate Subscription" (owner's reference screen) — assigns a
// plan to a tenant, overriding any existing active subscription.
export class ActivateSubscriptionDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  planId!: string;

  // Defaults to the plan's own durationDays if omitted.
  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;
}
