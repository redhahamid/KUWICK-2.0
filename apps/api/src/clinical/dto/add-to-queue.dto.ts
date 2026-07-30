import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

// Backs both entry points into a Visit + QueueTicket: the front-desk
// "Add to Daily Queue" action (Patients list) and AppointmentService's
// arrived() transition (docs/PRODUCT_REQUIREMENTS.md §6 — "arrived auto-
// creates a queue ticket").
export class AddToQueueDto {
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
  @IsString()
  presentingComplaint?: string;
}
