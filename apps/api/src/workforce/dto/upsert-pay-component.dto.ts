import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

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
  /** EA form box, e.g. "B.1(a)". Stored only — not used yet; the EA form is a later piece. UNVERIFIED. */
  @IsOptional() @IsString() @Length(1, 20) eaField?: string;
  @IsOptional() @IsBoolean() prorated?: boolean;
  @IsOptional() @IsBoolean() employerSide?: boolean;
  /** Layout, not treatment: the item gets its own editable column on the payroll grid. */
  @IsOptional() @IsBoolean() gridColumn?: boolean;
  /** Layout, not treatment: a new month starts with last month's hand-keyed amount. */
  @IsOptional() @IsBoolean() carryForward?: boolean;
  /** Payment, not treatment: the day of the month the item is paid. Kept from the current version when absent. */
  @IsOptional() @IsInt() @Min(1) @Max(31) payDay?: number;
  /** Paid in the run after the month it was earned in. Kept from the current version when absent. */
  @IsOptional() @IsBoolean() paidInArrears?: boolean;
  /** The pay date falls in the month after the run's. Kept from the current version when absent. */
  @IsOptional() @IsBoolean() paidFollowingMonth?: boolean;
  /** Who the item is for: everybody, or the employees named in `appliesToStaffIds`. Audience, not treatment. */
  @IsOptional() @IsIn(['EVERYONE', 'SELECTED']) appliesTo?: 'EVERYONE' | 'SELECTED';
  /** The people a SELECTED item is for. Ignored unless `appliesTo` is SELECTED. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) appliesToStaffIds?: string[];
  @IsOptional() @IsBoolean() active?: boolean;

  /**
   * THE DATE A CHANGED TREATMENT TAKES EFFECT.
   *
   * Required when any of the statutory attributes above changes on an existing
   * component, because the change is a NEW VERSION and not an edit: the
   * calculation resolves the catalogue BY PERIOD, so overwriting a row would
   * reprice every period that has not been approved yet. Optional on a new
   * component, which starts from the epoch so no period is left uncovered.
   */
  @IsOptional() @IsISO8601() effectiveFrom?: string;

  /**
   * WHY, IN THE WORDS OF WHOEVER DECIDED.
   *
   * REQUIRED when the statutory treatment of an existing component changes,
   * and kept on the version it explains rather than only in the audit log.
   * Whether an allowance is EPF-liable is a policy this clinic set, not a fact
   * Kuwick shipped, and the person who has to defend the figure a year later
   * needs the sentence next to the flag — not in a log they do not have open.
   *
   * Optional elsewhere: naming a new component or correcting a label decides
   * nothing about anybody's money.
   */
  @IsOptional() @IsString() @Length(4, 500) reason?: string;
}
