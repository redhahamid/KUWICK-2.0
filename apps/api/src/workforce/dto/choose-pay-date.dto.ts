import { IsISO8601 } from 'class-validator';

/** Every payment the run's record puts on `defaultDate` goes out on `payDate` instead, for that run alone. */
export class ChoosePayDateDto {
  @IsISO8601({ strict: true }) defaultDate!: string;
  @IsISO8601({ strict: true }) payDate!: string;
}
