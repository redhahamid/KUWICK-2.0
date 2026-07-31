import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreatePanelClinicDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitAmount?: number;

  // D-041 — the panel's payment term in days; drives per-panel overdue
  // judgement in the claim listing and aging views.
  @IsOptional()
  @IsInt()
  @Min(1)
  paymentTermDays?: number;
}

export class UpdatePanelClinicDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  paymentTermDays?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
