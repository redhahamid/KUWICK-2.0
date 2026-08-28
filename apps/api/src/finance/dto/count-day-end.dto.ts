import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Every bucket is OPTIONAL and every one defaults to nothing counted rather
 * than to zero. A counter who counts the drawer but not the card terminal has
 * counted the drawer — recording the terminal as RM0 would manufacture a
 * variance the size of the day's card takings.
 */
export class CountDayEndDto {
  @IsOptional()
  @Matches(MONEY)
  cash?: string;

  @IsOptional()
  @Matches(MONEY)
  card?: string;

  @IsOptional()
  @Matches(MONEY)
  qr?: string;

  @IsOptional()
  @Matches(MONEY)
  other?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  varianceReason?: string;
}
