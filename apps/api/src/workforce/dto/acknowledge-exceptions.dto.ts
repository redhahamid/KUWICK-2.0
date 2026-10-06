import { IsString, MaxLength, MinLength } from 'class-validator';

/** Acknowledge every open warning of one kind on a run, with one reason that goes on the record. */
export class AcknowledgeExceptionsDto {
  @IsString() @MaxLength(80) code!: string;
  @IsString() @MinLength(5, { message: 'Say why this is being passed. It becomes part of the payroll record.' }) @MaxLength(500) reason!: string;
}
