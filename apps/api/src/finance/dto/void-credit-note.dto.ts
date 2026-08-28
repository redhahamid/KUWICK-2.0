import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidCreditNoteDto {
  @IsString()
  @MinLength(5, { message: 'Say why this credit note is being withdrawn.' })
  @MaxLength(500)
  reason!: string;
}
