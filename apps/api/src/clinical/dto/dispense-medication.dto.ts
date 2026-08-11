import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * G4.5d5b-2 — what a dispensing request may say.
 *
 * Note what is ABSENT: a quantity. Partial dispensing is not implemented, and
 * the way to keep it unimplemented is to give the caller no field in which to
 * ask for it. The server reads the prescribed quantity from the prescription.
 */
export class DispenseMedicationDto {
  @IsString()
  visitId!: string;

  /** All from the same visit; the server refuses a mixed batch. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  prescriptionIds!: string[];

  /**
   * Set only when the user has been shown a shortage and accepted it. The
   * server will not create negative stock without it.
   */
  @IsOptional()
  @IsBoolean()
  acknowledgeStockWarning?: boolean;
}

export class PrintLabelDto {
  /** A physical sheet count. Bounded here and again in the database. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  copies?: number;
}
