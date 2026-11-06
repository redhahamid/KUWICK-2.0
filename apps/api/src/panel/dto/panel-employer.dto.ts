import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PanelTermAnchor, PanelTermUnit } from '@prisma/client';

/**
 * AN EMPLOYER BEHIND A PANEL (N-5; closes G-9).
 *
 * `name` is the only required field, because the counter's quick-add has one
 * box in it. A clinic typing a company name mid-registration should not be
 * asked for a payment term it does not know — the term is a contract fact
 * somebody looks up later, and an employer without one simply takes the
 * panel's, which is what every employer means until stated otherwise.
 */
export class CreatePanelEmployerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  /**
   * G-9. Set, it governs this employer's claims AS A WHOLE — see
   * `payment-terms.effectiveTerm`. Omitted, the panel's term applies.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(400)
  paymentTermDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(400)
  paymentTermMaxDays?: number;

  @IsOptional()
  @IsEnum(PanelTermUnit)
  paymentTermUnit?: PanelTermUnit;

  @IsOptional()
  @IsEnum(PanelTermAnchor)
  paymentTermAnchor?: PanelTermAnchor;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdatePanelEmployerDto extends CreatePanelEmployerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare name: string;

  /**
   * Employers are DEACTIVATED, never deleted: a claim already raised references
   * one, and the question "who was this billed to" has to keep an answer long
   * after the clinic stopped seeing that company.
   */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
