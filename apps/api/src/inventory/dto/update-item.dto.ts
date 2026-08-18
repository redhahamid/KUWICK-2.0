import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength, ValidateIf } from 'class-validator';
import { StandardPrescriptionDefaultsDto } from './standard-prescription-defaults.dto';

export class UpdateItemDto extends StandardPrescriptionDefaultsDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

  @IsOptional()
  @IsString()
  doseDefault?: string;

  @IsOptional()
  @IsString()
  doseUnitDefault?: string;

  @IsOptional()
  @IsString()
  frequencyDefault?: string;

  @IsOptional()
  @IsString()
  durationDefault?: string;

  @IsOptional()
  @IsString()
  instruction?: string;

  @IsOptional()
  @IsString()
  indication?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  concVolMl?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  strengthMg?: number;

  @IsOptional()
  @IsString()
  consumptionMethod?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDispenseQuantity?: number;

  @IsOptional()
  @IsString()
  prescriptionReference?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // ---- INVENTORY PIECE 2 — how this medicine is COUNTED (1E) -------------
  //
  // Phase 1E built `stockUnitId` and `quantityPerStockUnit` and a Settings
  // screen, and the pricing audit then found `quantity_per_stock_unit` set on
  // ZERO of 242 rows — because nothing in the API ever accepted them. The
  // majority of the catalogue has no divisor for `ceil(clinical ÷ divisor)`
  // for want of these fields.
  //
  // `null` is meaningful and distinct from absent: null CLEARS the value (the
  // clinic withdrawing a number they are no longer sure of), absent leaves it
  // alone. `ValidateIf` is what lets an explicit null through the UUID and
  // integer checks.

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  stockUnitId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  quantityPerStockUnit?: number | null;

  /** D1 — the DECLARATION. The server stamps who and when; a client cannot. */
  @IsOptional()
  @IsBoolean()
  dispensedWhole?: boolean;

  // ---- Stock Control ------------------------------------------------------

  /** Whether receiving this item asks for a batch number and an expiry. */
  @IsOptional()
  @IsBoolean()
  tracksBatchExpiry?: boolean;
}
