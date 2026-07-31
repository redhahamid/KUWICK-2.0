import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CompleteOrderServiceDto {
  @IsOptional()
  @IsString()
  result?: string;

  // Phase A7 — set together when the service has a matching FormTemplate.
  @IsOptional()
  @IsUUID()
  formTemplateId?: string;

  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;
}
