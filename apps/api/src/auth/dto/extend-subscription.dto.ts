import { IsInt, Min } from 'class-validator';

export class ExtendSubscriptionDto {
  @IsInt()
  @Min(1)
  extraDays!: number;
}
