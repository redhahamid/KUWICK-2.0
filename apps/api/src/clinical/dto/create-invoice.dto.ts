import { IsUUID } from 'class-validator';

// createdByStaffId is required, not defaulted server-side — invoice
// creation is deliberately staff-creatable (not gated to the visit's own
// attending doctor) so a locum can bill a visit they're covering.
export class CreateInvoiceDto {
  @IsUUID()
  visitId!: string;

  @IsUUID()
  createdByStaffId!: string;
}
