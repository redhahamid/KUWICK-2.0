import { IsOptional, IsUUID } from 'class-validator';

// D-038 — which room/station the patient is being called to. staffId
// (D-044) reassigns the visit's attending doctor at call time — the
// front-desk may not know which doctor will actually see the patient at
// add-to-queue time, and the doctor who calls the patient in is often the
// one who ends up treating them.
export class CallQueueTicketDto {
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;
}
