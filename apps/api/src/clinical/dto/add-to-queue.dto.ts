import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { QueueType } from '@prisma/client';

// Backs both entry points into a Visit + QueueTicket: the front-desk
// "Add to Daily Queue" action (Patients list) and AppointmentService's
// arrived() transition (docs/PRODUCT_REQUIREMENTS.md §6 — "arrived auto-
// creates a queue ticket").
export class AddToQueueDto {
  // D-038 — defaults to WALK_IN server-side when omitted.
  @IsOptional()
  @IsEnum(QueueType)
  queueType?: QueueType;

  @IsUUID()
  clinicId!: string;

  @IsUUID()
  patientId!: string;

  @IsUUID()
  staffId!: string;

  @IsString()
  @MinLength(1)
  billingType!: string;

  @IsOptional()
  @IsUUID()
  panelClinicId?: string;

  @IsOptional()
  @IsString()
  presentingComplaint?: string;
}
