import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpsertPayComponentDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @Length(1, 64) code!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsIn(['ADDITION', 'DEDUCTION', 'OVERTIME']) type!: 'ADDITION' | 'DEDUCTION' | 'OVERTIME';
  @IsIn(['REMUNERATION', 'ALLOWANCE', 'BENEFIT_IN_KIND', 'PERQUISITE', 'TAX_DEDUCTION', 'PAYROLL_DEDUCTION'])
  category!: 'REMUNERATION' | 'ALLOWANCE' | 'BENEFIT_IN_KIND' | 'PERQUISITE' | 'TAX_DEDUCTION' | 'PAYROLL_DEDUCTION';

  @IsOptional() @IsIn(['GROSS_AND_NET', 'GROSS_ONLY', 'NET_ONLY', 'NONE'])
  includeIn?: 'GROSS_AND_NET' | 'GROSS_ONLY' | 'NET_ONLY' | 'NONE';

  // The twelve statutory attributes. Every one ships UNVERIFIED.
  @IsOptional() @IsBoolean() pcbLiable?: boolean;
  @IsOptional() @IsBoolean() epfLiable?: boolean;
  @IsOptional() @IsBoolean() socsoLiable?: boolean;
  @IsOptional() @IsBoolean() eisLiable?: boolean;
  @IsOptional() @IsBoolean() hrdLiable?: boolean;
  @IsOptional() @IsBoolean() includeInOrpBase?: boolean;
  @IsOptional() @IsBoolean() includeInUnpaidLeaveBase?: boolean;
  @IsOptional() @IsBoolean() additionalRemuneration?: boolean;
  @IsOptional() @IsInt() @Min(0) pcbExemptionLimitCents?: number;
  @IsOptional() @IsString() @Length(1, 20) eaField?: string;
  @IsOptional() @IsBoolean() prorated?: boolean;
  @IsOptional() @IsBoolean() employerSide?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
