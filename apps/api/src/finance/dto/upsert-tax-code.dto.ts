import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { TaxTreatment } from '@prisma/client';

export class UpsertTaxCodeDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Matches(/^[A-Z0-9][A-Z0-9-]{0,19}$/, { message: 'A tax code is uppercase letters, digits and hyphens.' })
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEnum(TaxTreatment)
  treatment!: TaxTreatment;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
