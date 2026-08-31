import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { FinanceController } from './finance.controller';
import { PaymentService } from './payment.service';
import { CreditNoteService } from './credit-note.service';
import { DayEndService } from './day-end.service';
import { TaxService } from './tax.service';
import { ReceivablesService } from './receivables.service';
import { ProfitabilityService } from './profitability.service';
import { SupplierPayablesService } from './supplier-payables.service';
import { PanelMoneyService } from './panel-money.service';

/**
 * WAVE 1 of the admin programme.
 *
 * Owns `payments`, `credit_notes`, `tax_codes`, `tax_rates` and
 * `day_end_closings`. Reads invoices; never writes an invoice LINE — that
 * stays with `InvoiceService`, which owns the billing rules. The one invoice
 * column this module writes is the settlement mirror (`patientPaidAmount` /
 * `status` / `paidAt`), and it writes it from the payment ledger so the two
 * representations cannot drift.
 *
 * It also owns ACCOUNTS PAYABLE — `supplier_invoices`, `supplier_payments` and
 * their allocations. Payables sit here rather than in Stock because the
 * question they answer ("what must I pay this week") is a finance question,
 * even though the documents arrive with the stock. Stock still owns the
 * purchase order and the goods receipt; an invoice only LINKS to them.
 *
 * And it READS panel claims, to answer the questions the panel work queue
 * structurally cannot: what we billed panels and never claimed, what their
 * admin fees cost us, and what they actually banked. It writes nothing in the
 * panel module — see panel-money.service.ts.
 */
@Module({
  imports: [CoreModule],
  controllers: [FinanceController],
  providers: [
    PaymentService,
    CreditNoteService,
    DayEndService,
    TaxService,
    ReceivablesService,
    ProfitabilityService,
    SupplierPayablesService,
    PanelMoneyService,
  ],
  exports: [PaymentService, TaxService, DayEndService],
})
export class FinanceModule {}
