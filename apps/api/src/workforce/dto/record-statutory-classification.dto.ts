import { IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * A COMPLETE STATEMENT OF STATUTORY STANDING FROM A DATE — not a patch.
 *
 * Every field is optional on the wire because the service carries the version
 * in force forward and applies only what was sent; what is STORED is always
 * the whole standing, so a version can be read on its own without replaying
 * the chain. Sending nothing at all is refused: a version that changes nothing
 * is a row with no fact in it.
 */
export class RecordStatutoryClassificationDto {
  @IsISO8601() effectiveFrom!: string;

  @IsOptional() @IsBoolean() epfApplicable?: boolean;
  @IsOptional()
  @IsIn(['MALAYSIAN_CITIZEN', 'PERMANENT_RESIDENT', 'NON_CITIZEN_ELECTED_PRE_1998', 'NON_CITIZEN', null])
  epfMembership?: 'MALAYSIAN_CITIZEN' | 'PERMANENT_RESIDENT' | 'NON_CITIZEN_ELECTED_PRE_1998' | 'NON_CITIZEN' | null;
  @IsOptional() @IsNumber() @Min(0) @Max(30) epfEmployeeRate?: number | null;
  @IsOptional() @IsBoolean() socsoApplicable?: boolean;
  @IsOptional() @IsBoolean() eisApplicable?: boolean;
  @IsOptional()
  @IsIn(['MANDATORY_FOREIGN_WORKER', 'ENROLLED', 'NOT_PARTICIPATING', null])
  lindungParticipation?: 'MANDATORY_FOREIGN_WORKER' | 'ENROLLED' | 'NOT_PARTICIPATING' | null;

  @IsOptional() @IsBoolean() pcbApplicable?: boolean;
  @IsOptional() @IsIn(['RESIDENT', 'NON_RESIDENT', null]) taxResidence?: 'RESIDENT' | 'NON_RESIDENT' | null;
  @IsOptional()
  @IsIn(['CATEGORY_1', 'CATEGORY_2', 'CATEGORY_3', null])
  pcbCategory?: 'CATEGORY_1' | 'CATEGORY_2' | 'CATEGORY_3' | null;
  @IsOptional() @IsInt() @Min(0) @Max(20) qualifyingChildren?: number;
  @IsOptional() @IsBoolean() disabledSelf?: boolean;
  @IsOptional() @IsBoolean() disabledSpouse?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(6) restDayOfWeek?: number | null;
  /** True when the rest day is not a fixed weekday (s.59 lets the employer vary it). Sent with restDayOfWeek null. */
  @IsOptional() @IsBoolean() restDayVaries?: boolean;
  /** The rest day rotates with the roster. True implies restDayVaries and no weekday; a weekday ends it. */
  @IsOptional() @IsBoolean() restDayFollowsRoster?: boolean;
  /** On top of the computed MTD each month, in cents: a CP38 direction or the employee's own request. 0 clears it. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) additionalPcbCents?: number;
  @IsOptional() @IsString() @MaxLength(120) additionalPcbNote?: string | null;
  @IsOptional()
  @IsIn(['PAY_AT_STATUTORY_RATES', 'NOT_PAID', null])
  overtimeContractPolicy?: 'PAY_AT_STATUTORY_RATES' | 'NOT_PAID' | null;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() note?: string;

  /**
   * For a change dated before later versions: carry the changed fields into
   * each later version that still holds the old value. A later version that
   * changed the same field deliberately keeps its own value either way.
   */
  @IsOptional() @IsBoolean() applyToLater?: boolean;
}

/**
 * The employer's HRD Corp class from a date. The RATE is not on this form:
 * 1% (section 14) and 0.5% (section 15) are the PSMB Act's numbers, and a
 * field that accepted a typed rate accepted a levy nobody could reconcile.
 */
export class RecordEmployerStatutoryDto {
  @IsISO8601() effectiveFrom!: string;

  @IsIn(['MANDATORY_SECTION_14', 'OPTIONAL_SECTION_15', 'NOT_REGISTERED'])
  hrdRegistration!: 'MANDATORY_SECTION_14' | 'OPTIONAL_SECTION_15' | 'NOT_REGISTERED';

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() note?: string;
}
