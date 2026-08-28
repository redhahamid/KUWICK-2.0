import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class ClockDto {
  /** Omit to clock yourself. Naming somebody else is a supervisory act. */
  @IsOptional() @IsUUID() staffId?: string;
  @IsOptional() @IsUUID() clinicId?: string;
  @IsOptional() @IsISO8601() at?: string;
}
