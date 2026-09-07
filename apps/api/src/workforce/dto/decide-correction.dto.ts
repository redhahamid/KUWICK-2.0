import { IsBoolean, IsOptional, Length } from 'class-validator';

export class DecideCorrectionDto {
  /** True approves and applies it; false records the refusal and its reason. */
  @IsBoolean() approve!: boolean;
  /** Why. Optional on an approval, and what an employee reads on a refusal. */
  @IsOptional() @Length(3, 500) note?: string;
}
