import { IsBoolean } from 'class-validator';

/**
 * Whether the counter pre-selects a patient's last panel (N-5).
 *
 * Required, not optional: a toggle whose absence meant "off" would be turned
 * off by any client that forgot to send the field.
 */
export class SetAutoSelectDto {
  @IsBoolean()
  enabled!: boolean;
}
