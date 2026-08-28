import { IsArray, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { EmploymentType, IncentiveRuleType } from '@prisma/client';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,3})?$/;

export class UpsertIncentiveRuleDto {
  @IsString() @MaxLength(120) name!: string;
  @IsEnum(IncentiveRuleType) ruleType!: IncentiveRuleType;

  /**
   * Set to create a NEW VERSION of an existing rule. There is deliberately no
   * update path: editing a rule in place makes every historic payment
   * unreproducible.
   */
  @IsOptional() @IsUUID() supersedesRuleId?: string;

  @IsISO8601() effectiveFrom!: string;

  @IsOptional() @IsUUID() clinicId?: string;
  @IsOptional() @IsUUID() staffId?: string;
  /** How "a different rate for resident vs locum" is expressed. */
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;

  @IsOptional() @Matches(MONEY) thresholdAmount?: string;
  @IsOptional() @Matches(MONEY) flatAmount?: string;
  @IsOptional() @Matches(PERCENT) percentAbove?: string;

  @IsOptional() @Matches(MONEY) perProcedureAmount?: string;
  @IsOptional() @Matches(PERCENT) perProcedurePercent?: string;

  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) serviceCatalogIds?: string[];
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) excludedServiceCatalogIds?: string[];

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
