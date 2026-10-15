import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt } from 'class-validator';
import { MALAYSIAN_STATES } from '../holiday-presets';

export class LoadHolidayPresetsDto {
  @IsInt()
  year!: number;

  @IsIn(MALAYSIAN_STATES)
  state!: string;

  /** The dates the clinic ticked; anything not in the list for that state is refused. */
  @IsArray()
  @ArrayMaxSize(60)
  @IsDateString({}, { each: true })
  dates!: string[];
}
