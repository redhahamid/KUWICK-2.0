import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelStockTransferDto {
  @IsString()
  @MinLength(5, { message: 'Say why this transfer is being cancelled.' })
  @MaxLength(500)
  reason!: string;
}
