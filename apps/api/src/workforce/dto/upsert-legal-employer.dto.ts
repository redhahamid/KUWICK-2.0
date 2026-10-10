import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpsertLegalEmployerDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @Length(2, 200) name!: string;
  @IsOptional() @IsString() @Length(1, 50) registrationNo?: string;
  @IsOptional() @IsString() @Length(1, 50) epfEmployerNo?: string;
  @IsOptional() @IsString() @Length(1, 50) socsoEmployerNo?: string;
  @IsOptional() @IsString() @Length(1, 50) lhdnEmployerNo?: string;
  @IsOptional() @IsString() @Length(1, 50) hrdRegistrationNo?: string;
  /**
   * LEGACY, AND REFUSED. Declared so a caller that still sends it gets a
   * sentence saying where the HRD class goes, rather than having it silently
   * whitelisted away by the global validation pipe.
   */
  @IsOptional() @IsString() @Length(1, 50) hrdCategory?: string;
  /** Stored only. NO calculation applies it — HRD is a blocked statutory item. */
  @IsOptional() @IsNumber() @Min(0) @Max(1) hrdLevyRate?: number;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() postcode?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankAccountNo?: string;
  @IsOptional() @IsString() bankAccountName?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** What the HRD levy is worked out on. Absent keeps what the employer has. */
  @IsOptional() @IsIn(['BASIC_ONLY', 'BASIC_PLUS_FIXED_ALLOWANCES']) hrdLevyBase?: 'BASIC_ONLY' | 'BASIC_PLUS_FIXED_ALLOWANCES';
  /** The EPF basis new staff are given (UAT, 10 October 2026). Absent keeps what the employer has. */
  @IsOptional() @IsIn(['BASIC_ONLY', 'ALL_APPLICABLE']) defaultEpfBasis?: 'BASIC_ONLY' | 'ALL_APPLICABLE';
  /** Whether zakat is deducted through payroll. Absent keeps what the employer has. */
  @IsOptional() @IsBoolean() zakatThroughPayroll?: boolean;
}
