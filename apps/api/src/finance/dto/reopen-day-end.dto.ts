import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReopenDayEndDto {
  @IsString()
  @MinLength(5, { message: 'Say why this day is being reopened.' })
  @MaxLength(500)
  reason!: string;
}
