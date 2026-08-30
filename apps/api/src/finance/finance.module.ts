import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { FinanceController } from './finance.controller';
import { PaymentService } from './payment.service';
import { CreditNoteService } from './credit-note.service';
import { DayEndService } from './day-end.service';
import { TaxService } from './tax.service';
import { ReceivablesService } from './receivables.service';
import { ProfitabilityService } from './profitability.service';

/**
 * WAVE 1 of the admin programme.
 *
 * Owns `payments`, `credit_notes`, `tax_codes`, `tax_rates` and
 * `day_end_closings`. Reads invoices; never writes an invoice LINE — that
 * stays with `InvoiceService`, which owns the billing rules. The one invoice
 * column this module writes is the settlement mirror (`patientPaidAmount` /
 * `status` / `paidAt`), and it writes it from the payment ledger so the two
 * representations cannot drift.
 */
@Module({
  imports: [CoreModule],
  controllers: [FinanceController],
  providers: [PaymentService, CreditNoteService, DayEndService, TaxService, ReceivablesService, ProfitabilityService],
  exports: [PaymentService, TaxService, DayEndService],
})
export class FinanceModule {}
