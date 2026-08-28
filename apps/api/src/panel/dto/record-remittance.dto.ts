import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class RemittanceAllocationDto {
  @IsUUID()
  claimLineId!: string;

  @Matches(MONEY)
  amount!: string;
}

export class RecordRemittanceDto {
  @IsUUID()
  panelClinicId!: string;

  @IsISO8601()
  receivedAt!: string;

  @Matches(MONEY)
  grossAmount!: string;

  /** What the panel withheld across the whole payment — its fee, or tax. */
  @IsOptional()
  @Matches(MONEY)
  withheldAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  remittanceRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Which claims this settled. The SERVICE requires them to total the net
   * exactly — a remittance that does not add up is refused at entry rather
   * than found in a reconciliation weeks later.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RemittanceAllocationDto)
  allocations!: RemittanceAllocationDto[];
}
