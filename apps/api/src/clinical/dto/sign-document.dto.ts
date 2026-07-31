import { IsUUID } from 'class-validator';

export class SignDocumentDto {
  @IsUUID()
  staffId!: string;
}
