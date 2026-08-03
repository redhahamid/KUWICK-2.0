import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelQueueTicketDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;

  /**
   * G4.5d3c-1c (D-085) — idempotency key. A retried cancellation writes one
   * audit event rather than two; the unique index on (tenantId,
   * correlationId) is what enforces it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  correlationId?: string;
}
