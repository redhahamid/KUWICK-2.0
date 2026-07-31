import { IsOptional, IsUUID } from 'class-validator';

// D-038 — which room/station the patient is being called to.
export class CallQueueTicketDto {
  @IsOptional()
  @IsUUID()
  roomId?: string;
}
