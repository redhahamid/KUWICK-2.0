import { IsOptional, IsString } from 'class-validator';

export class CancelQueueTicketDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
