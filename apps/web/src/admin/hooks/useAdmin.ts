import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import type {
  CreditNoteRow,
  DayEndView,
  EmployeeRow,
  IncentiveRunDetail,
  IncentiveRunRow,
  InvoicePosition,
  MarketingAudienceResult,
  MarketingHistory,
  MarketingTemplateRow,
  OpenDayRow,
  OperationsOverview,
  PanelConfigRow,
  NewItemRequestRow,
  PayableInvoiceRow,
  ClaimImportBatchRow,
  ClaimImportResult,
  PanelMoneyPosition,
  PayablesSummary,
  SupplierOption,
  SupplierPaymentRow,
  PanelReconciliation,
  PanelWorkQueueRow,
  PaymentReport,
  PayrollRunDetail,
  PayrollRunRow,
  ProgrammeDashboard,
  ProgrammeRow,
  ReceivablesReport,
  SegmentPl,
  StatutoryRuleSetRow,
  StockExceptions,
  StockMovementRow,
  StockTakeDetail,
  StockTakeRow,
  StockTransferRow,
  StockValuation,
  SubmissionQueueRow,
  TaxCode,
  EmployeeRecord,
  PreparedDispatchResult,
  ProfitabilityReport,
  StaffBenefitReport,
  TaxReport,
  TimesheetReport,
  PanelAwaitingPaymentRow,
  WorkforceToday,
} from '../types';

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Every mutation here invalidates by MODULE PREFIX rather than by exact key.
 *
 * Recording a payment changes the invoice position, the day-end, the
 * receivables report and the payment report — four screens a person may have
 * open at once. Invalidating the prefix means none of them can show a stale
 * balance, which in a finance module is the difference between a correct
 * screen and a convincing wrong one.
 */
function useAdminMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidatePrefixes: string[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const prefix of invalidatePrefixes) {
        void queryClient.invalidateQueries({ queryKey: [prefix] });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// FINANCE
// ---------------------------------------------------------------------------

export function useInvoicePosition(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ['admin-finance', 'position', invoiceId],
    queryFn: () => apiClient.get<InvoicePosition>(`/finance/invoices/${invoiceId}/position`),
    enabled: Boolean(invoiceId),
  });
}

export function useRecordPayment(invoiceId: string) {
  return useAdminMutation(
    (body: { amount: string; tender?: string; methodLabel?: string; kind?: string; referenceNo?: string; notes?: string; allowOverpayment?: boolean }) =>
      apiClient.post(`/finance/invoices/${invoiceId}/payments`, body),
    ['admin-finance'],
  );
}

export function useReversePayment() {
  return useAdminMutation(
    ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      apiClient.post(`/finance/payments/${paymentId}/reverse`, { reason }),
    ['admin-finance'],
  );
}

export function useDayEnd(date: string, clinicId?: string) {
  return useQuery({
    queryKey: ['admin-finance', 'day-end', date, clinicId],
    queryFn: () => apiClient.get<DayEndView>(`/finance/day-end${qs({ date, clinicId })}`),
    enabled: Boolean(date),
  });
}

export function useOpenDays(clinicId?: string) {
  return useQuery({
    queryKey: ['admin-finance', 'open-days', clinicId],
    queryFn: () => apiClient.get<OpenDayRow[]>(`/finance/day-end/open${qs({ clinicId })}`),
  });
}

export function useCountDayEnd(date: string, clinicId?: string) {
  return useAdminMutation(
    (body: { cash?: string; card?: string; qr?: string; other?: string; varianceReason?: string }) =>
      apiClient.post(`/finance/day-end/count${qs({ date, clinicId })}`, body),
    ['admin-finance'],
  );
}

export function useCloseDayEnd(date: string, clinicId?: string) {
  return useAdminMutation(
    (body: { varianceReason?: string }) => apiClient.post(`/finance/day-end/close${qs({ date, clinicId })}`, body),
    ['admin-finance'],
  );
}

export function useReopenDayEnd(date: string, clinicId?: string) {
  return useAdminMutation(
    (body: { reason: string }) => apiClient.post(`/finance/day-end/reopen${qs({ date, clinicId })}`, body),
    ['admin-finance'],
  );
}

export function usePatientReceivables(params: { clinicId?: string; asOf?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'receivables', params],
    queryFn: () => apiClient.get<ReceivablesReport>(`/finance/receivables/patients${qs(params)}`),
  });
}

export function usePaymentReport(params: { from: string; to: string; clinicId?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'payments', params],
    queryFn: () => apiClient.get<PaymentReport>(`/finance/payments${qs(params)}`),
    enabled: Boolean(params.from && params.to),
  });
}

export function useCreditNotes(params: { clinicId?: string; status?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'credit-notes', params],
    queryFn: () => apiClient.get<CreditNoteRow[]>(`/finance/credit-notes${qs(params)}`),
  });
}

export function useCreateCreditNote() {
  return useAdminMutation(
    (body: { invoiceId: string; reason: string; lines: { invoiceLineId?: string; description: string; amount: string }[] }) =>
      apiClient.post('/finance/credit-notes', body),
    ['admin-finance'],
  );
}

export function useApproveCreditNote() {
  return useAdminMutation((id: string) => apiClient.patch(`/finance/credit-notes/${id}/approve`, {}), ['admin-finance']);
}

export function useTaxReport(params: { from: string; to: string; clinicId?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'tax', params],
    queryFn: () => apiClient.get<TaxReport>(`/finance/tax/report${qs(params)}`),
    enabled: Boolean(params.from && params.to),
  });
}

export function useTaxCodes() {
  return useQuery({
    queryKey: ['admin-finance', 'tax-codes'],
    queryFn: () => apiClient.get<TaxCode[]>('/finance/tax/codes'),
  });
}

// ---------------------------------------------------------------------------
// STOCK
// ---------------------------------------------------------------------------

export function useStockExceptions(clinicId?: string) {
  return useQuery({
    queryKey: ['admin-stock', 'exceptions', clinicId],
    queryFn: () => apiClient.get<StockExceptions>(`/stock-admin/exceptions${qs({ clinicId })}`),
  });
}

export function useStockExceptionRows(kind: string | undefined, clinicId?: string) {
  return useQuery({
    queryKey: ['admin-stock', 'exception-rows', kind, clinicId],
    queryFn: () => apiClient.get<Record<string, unknown>[]>(`/stock-admin/exceptions/${kind}${qs({ clinicId })}`),
    enabled: Boolean(kind),
  });
}

export function useStockValuation(clinicId?: string) {
  return useQuery({
    queryKey: ['admin-stock', 'valuation', clinicId],
    queryFn: () => apiClient.get<StockValuation>(`/stock-admin/valuation${qs({ clinicId })}`),
  });
}

export function useStockMovements(params: { clinicId?: string; itemId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['admin-stock', 'movements', params],
    queryFn: () => apiClient.get<StockMovementRow[]>(`/stock-admin/movements${qs(params)}`),
  });
}

export function useAdjustStock() {
  return useAdminMutation(
    (body: { clinicId?: string; itemId: string; quantityDelta: number; reason: string; notes?: string }) =>
      apiClient.post('/stock-admin/adjustments', body),
    ['admin-stock'],
  );
}

export function useStockTransfers(params: { clinicId?: string; status?: string; direction?: string }) {
  return useQuery({
    queryKey: ['admin-stock', 'transfers', params],
    queryFn: () => apiClient.get<StockTransferRow[]>(`/stock-admin/transfers${qs(params)}`),
  });
}

export function useCreateTransfer() {
  return useAdminMutation(
    (body: { fromClinicId: string; toClinicId: string; notes?: string; interCompany?: boolean; lines: { itemId: string; quantity: number }[] }) =>
      apiClient.post('/stock-admin/transfers', body),
    ['admin-stock'],
  );
}

export function useSendTransfer() {
  return useAdminMutation((id: string) => apiClient.patch(`/stock-admin/transfers/${id}/send`, {}), ['admin-stock']);
}

export function useReceiveTransfer() {
  return useAdminMutation(
    ({ id, lines }: { id: string; lines: { lineId: string; quantityReceived: number; discrepancyReason?: string }[] }) =>
      apiClient.patch(`/stock-admin/transfers/${id}/receive`, { lines }),
    ['admin-stock'],
  );
}

export function useStockTakes(clinicId?: string) {
  return useQuery({
    queryKey: ['admin-stock', 'takes', clinicId],
    queryFn: () => apiClient.get<StockTakeRow[]>(`/stock-admin/stock-takes${qs({ clinicId })}`),
  });
}

export function useStockTake(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-stock', 'take', id],
    queryFn: () => apiClient.get<StockTakeDetail>(`/stock-admin/stock-takes/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateStockTake() {
  return useAdminMutation(
    (body: { clinicId?: string; name: string; location?: string; category?: string; counterStaffIds?: string[] }) =>
      apiClient.post('/stock-admin/stock-takes', body),
    ['admin-stock'],
  );
}

export function useRecordCounts(id: string) {
  return useAdminMutation(
    (counts: { lineId: string; quantity: number; looseUnits?: number; varianceReason?: string }[]) =>
      apiClient.patch(`/stock-admin/stock-takes/${id}/counts`, { counts }),
    ['admin-stock'],
  );
}

export function useSubmitStockTake() {
  return useAdminMutation((id: string) => apiClient.patch(`/stock-admin/stock-takes/${id}/submit`, {}), ['admin-stock']);
}

export function useApproveStockTake() {
  return useAdminMutation(
    ({ id, excludeLineIds, notes }: { id: string; excludeLineIds?: string[]; notes?: string }) =>
      apiClient.patch(`/stock-admin/stock-takes/${id}/approve`, { excludeLineIds, notes }),
    ['admin-stock'],
  );
}

// ---------------------------------------------------------------------------
// PANEL
// ---------------------------------------------------------------------------

export function usePanelSubmissionQueue(panelClinicId?: string) {
  return useQuery({
    queryKey: ['admin-panel', 'submission-queue', panelClinicId],
    queryFn: () => apiClient.get<SubmissionQueueRow[]>(`/panel-workspace/submission-queue${qs({ panelClinicId })}`),
  });
}

export function usePanelReconciliation(params: { panelClinicId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['admin-panel', 'reconciliation', params],
    queryFn: () => apiClient.get<PanelReconciliation>(`/panel-workspace/reconciliation${qs(params)}`),
  });
}

export function usePanelAwaitingPayment(params: { panelClinicId?: string }, enabled = true) {
  return useQuery({
    queryKey: ['admin-panel', 'awaiting-payment', params],
    queryFn: () => apiClient.get<PanelAwaitingPaymentRow[]>(`/panel-workspace/awaiting-payment${qs(params)}`),
    enabled,
  });
}

export function usePanelWorkQueue(params: { panelClinicId?: string; includeResolved?: boolean }) {
  return useQuery({
    queryKey: ['admin-panel', 'work-queue', params],
    queryFn: () => apiClient.get<PanelWorkQueueRow[]>(`/panel-workspace/work-queue${qs(params)}`),
  });
}

export function usePanelConfigs() {
  return useQuery({
    queryKey: ['admin-panel', 'panels'],
    queryFn: () => apiClient.get<PanelConfigRow[]>('/panel-workspace/panels'),
  });
}

export function useUpdatePanelConfig() {
  return useAdminMutation(
    ({ id, ...body }: { id: string } & Record<string, unknown>) => apiClient.patch(`/panel-workspace/panels/${id}`, body),
    // A fee term changes what every panel receivable is worth, and receivables
    // are shown in Finance ▸ Outstanding as well as in Panel.
    ['admin-panel', 'admin-finance'],
  );
}

/**
 * G-5 — the panel refused, so the patient pays. Not a write-off: the money is
 * still coming, it just moves onto the invoice's patient share.
 */
export function useChargeClaimToPatient() {
  return useAdminMutation(
    ({ claimLineId, ...body }: { claimLineId: string; amount?: string; reason: string }) =>
      apiClient.patch(`/panel-workspace/claims/${claimLineId}/charge-to-patient`, body),
    ['admin-panel', 'admin-finance'],
  );
}

// ---------------------------------------------------------------------------
// NEW ITEM REQUESTS
// ---------------------------------------------------------------------------

export function useNewItemRequests() {
  return useQuery({
    queryKey: ['admin-stock', 'new-item-requests'],
    queryFn: () => apiClient.get<NewItemRequestRow[]>('/new-item-requests'),
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ['admin-stock', 'suppliers'],
    queryFn: () => apiClient.get<SupplierOption[]>('/suppliers'),
  });
}

export function useRaiseNewItemRequest() {
  return useAdminMutation(
    (body: {
      requestedName: string;
      reason: string;
      comments?: string;
      packSizeNote?: string;
      suggestedSupplierId?: string;
      indicativeCost?: string;
      indicativePrice?: string;
    }) => apiClient.post('/new-item-requests', body),
    ['admin-stock'],
  );
}

export function useApproveNewItemRequest() {
  return useAdminMutation(
    ({ id, ...body }: {
      id: string;
      name?: string;
      code?: string;
      category?: string;
      unitOfMeasure?: string;
      sellPrice: string;
      cost?: string;
      decisionNote?: string;
      acknowledgeDuplicate?: boolean;
    }) => apiClient.patch(`/new-item-requests/${id}/approve`, body),
    ['admin-stock'],
  );
}

export function useRejectNewItemRequest() {
  return useAdminMutation(
    ({ id, ...body }: { id: string; decisionNote: string }) =>
      apiClient.patch(`/new-item-requests/${id}/reject`, body),
    ['admin-stock'],
  );
}

// ---------------------------------------------------------------------------
// ACCOUNTS PAYABLE
// ---------------------------------------------------------------------------

export function usePayables(params: { asOf?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'payables', params],
    queryFn: () =>
      apiClient.get<PayablesSummary>(`/finance/payables${params.asOf ? `?asOf=${params.asOf}` : ''}`),
  });
}

/**
 * PANEL MONEY, FROM FINANCE — billed vs claimed, what the fee cost, and what
 * the panels actually banked. See apps/api/src/finance/panel-money.ts.
 */
/**
 * THE HISTORICAL CLAIM IMPORT (G-12).
 *
 * `commit` is FALSE by default on the server, so calling this without it is a
 * dry run that reports the totals and writes nothing. The screen makes the
 * clinic read those totals before it offers the commit button.
 */
export function useImportClaims() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      panelClinicId: string;
      clinicId?: string;
      csv: string;
      fileName?: string;
      note?: string;
      commit?: boolean;
    }) => apiClient.post<ClaimImportResult>('/panel-workspace/import/claims', body),
    onSuccess: (result) => {
      if (!result.dryRun) {
        queryClient.invalidateQueries({ queryKey: ['admin-panel'] });
        queryClient.invalidateQueries({ queryKey: ['admin-finance'] });
      }
    },
  });
}

export function useClaimImportBatches(panelClinicId?: string) {
  return useQuery({
    queryKey: ['admin-panel', 'import-batches', panelClinicId ?? null],
    queryFn: () =>
      apiClient.get<ClaimImportBatchRow[]>(
        `/panel-workspace/import/batches${panelClinicId ? `?panelClinicId=${panelClinicId}` : ''}`,
      ),
  });
}

export function usePanelMoney(params: { from?: string; to?: string; panelClinicId?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'panel-money', params],
    queryFn: () => {
      const query = new URLSearchParams();
      if (params.from) query.set('from', params.from);
      if (params.to) query.set('to', params.to);
      if (params.panelClinicId) query.set('panelClinicId', params.panelClinicId);
      const suffix = query.toString();
      return apiClient.get<PanelMoneyPosition>(`/finance/panel-money${suffix ? `?${suffix}` : ''}`);
    },
  });
}

export function usePayableInvoices(params: { supplierId?: string; asOf?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'payable-invoices', params],
    queryFn: () => {
      const query = new URLSearchParams();
      if (params.supplierId) query.set('supplierId', params.supplierId);
      if (params.asOf) query.set('asOf', params.asOf);
      const suffix = query.toString();
      return apiClient.get<PayableInvoiceRow[]>(`/finance/payables/invoices${suffix ? `?${suffix}` : ''}`);
    },
  });
}

export function useSupplierPayments(params: { supplierId?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'supplier-payments', params],
    queryFn: () =>
      apiClient.get<SupplierPaymentRow[]>(
        `/finance/payables/payments${params.supplierId ? `?supplierId=${params.supplierId}` : ''}`,
      ),
  });
}

export function useRecordSupplierInvoice() {
  return useAdminMutation(
    (body: {
      supplierId: string;
      invoiceNumber: string;
      invoiceDate: string;
      totalAmount: string;
      dueDate?: string;
      goodsReceivedNoteId?: string;
      documentUrl?: string;
      notes?: string;
    }) => apiClient.post('/finance/payables/invoices', body),
    ['admin-finance'],
  );
}

export function useUpdateSupplierInvoice() {
  return useAdminMutation(
    ({ id, ...body }: { id: string; status?: string; disputeReason?: string; dueDate?: string; notes?: string }) =>
      apiClient.patch(`/finance/payables/invoices/${id}`, body),
    ['admin-finance'],
  );
}

export function useRecordSupplierPayment() {
  return useAdminMutation(
    (body: {
      supplierId: string;
      paidAt: string;
      amount: string;
      method?: string;
      reference?: string;
      allocations: { supplierInvoiceId: string; amount: string }[];
    }) => apiClient.post('/finance/payables/payments', body),
    ['admin-finance'],
  );
}

export function useUpdateSupplierTerms() {
  return useAdminMutation(
    ({ id, ...body }: {
      id: string;
      paymentTermDays?: number;
      creditLimitAmount?: string;
      deliverySlaDays?: number;
    }) => apiClient.patch(`/finance/payables/suppliers/${id}/terms`, body),
    ['admin-finance', 'admin-stock'],
  );
}

export function useMarkBatchSubmitted() {
  return useAdminMutation(
    ({ batchId, ...body }: { batchId: string; submissionMethod: string; submissionReference?: string }) =>
      apiClient.patch(`/panel-workspace/batches/${batchId}/submitted`, body),
    ['admin-panel'],
  );
}

export function useAdjudicateClaim() {
  return useAdminMutation(
    ({ claimLineId, ...body }: {
      claimLineId: string;
      approvedAmount: string;
      rejectedAmount?: string;
      rejectionReason?: string;
      rejectionCategory?: string;
      panelClaimNo?: string;
    }) => apiClient.patch(`/panel-workspace/claims/${claimLineId}/adjudicate`, body),
    ['admin-panel'],
  );
}

export function useResubmitClaim() {
  return useAdminMutation(
    ({ claimLineId, ...body }: { claimLineId: string; reason: string; claimedAmount?: string }) =>
      apiClient.post(`/panel-workspace/claims/${claimLineId}/resubmit`, body),
    ['admin-panel'],
  );
}

export function useWriteOffClaim() {
  return useAdminMutation(
    ({ claimLineId, ...body }: { claimLineId: string; reason: string; amount?: string }) =>
      apiClient.patch(`/panel-workspace/claims/${claimLineId}/write-off`, body),
    ['admin-panel'],
  );
}

export function useRecordRemittance() {
  return useAdminMutation(
    (body: {
      panelClinicId: string;
      receivedAt: string;
      grossAmount: string;
      withheldAmount?: string;
      remittanceRef?: string;
      allocations: { claimLineId: string; amount: string }[];
    }) => apiClient.post('/panel-workspace/remittances', body),
    ['admin-panel'],
  );
}

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

export function useWorkforceToday(clinicId?: string) {
  return useQuery({
    queryKey: ['admin-hr', 'today', clinicId],
    queryFn: () => apiClient.get<WorkforceToday>(`/workforce/today${qs({ clinicId })}`),
  });
}

export function useEmployees(params: { clinicId?: string; status?: string; search?: string }) {
  return useQuery({
    queryKey: ['admin-hr', 'employees', params],
    queryFn: () => apiClient.get<EmployeeRow[]>(`/workforce/employees${qs(params)}`),
  });
}

export function useUpsertEmployee() {
  return useAdminMutation(
    ({ staffId, ...body }: { staffId: string } & Record<string, unknown>) =>
      apiClient.post(`/workforce/employees/${staffId}`, body),
    ['admin-hr'],
  );
}

export function useTimesheet(params: { from: string; to: string; clinicId?: string; staffId?: string }) {
  return useQuery({
    queryKey: ['admin-hr', 'timesheet', params],
    queryFn: () => apiClient.get<TimesheetReport>(`/workforce/attendance/timesheet${qs(params)}`),
    enabled: Boolean(params.from && params.to),
  });
}

export function useCorrectAttendance() {
  return useAdminMutation(
    ({ id, ...body }: { id: string; clockInAt?: string; clockOutAt?: string; status?: string; reason: string }) =>
      apiClient.patch(`/workforce/attendance/${id}/correct`, body),
    ['admin-hr'],
  );
}

export function useApproveOvertime() {
  return useAdminMutation(
    ({ id, minutes }: { id: string; minutes?: number }) =>
      apiClient.patch(`/workforce/attendance/${id}/approve-overtime`, { minutes }),
    ['admin-hr'],
  );
}

export function usePayrollRuns(params: { clinicId?: string; year?: number }) {
  return useQuery({
    queryKey: ['admin-hr', 'payroll-runs', params],
    queryFn: () => apiClient.get<PayrollRunRow[]>(`/workforce/payroll/runs${qs(params)}`),
  });
}

export function usePayrollRun(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-hr', 'payroll-run', id],
    queryFn: () => apiClient.get<PayrollRunDetail>(`/workforce/payroll/runs/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreatePayrollRun() {
  return useAdminMutation(
    (body: { period: string; clinicId?: string; notes?: string }) => apiClient.post('/workforce/payroll/runs', body),
    ['admin-hr'],
  );
}

export function useCalculatePayroll() {
  return useAdminMutation((id: string) => apiClient.patch(`/workforce/payroll/runs/${id}/calculate`, {}), ['admin-hr']);
}

export function useApprovePayroll() {
  return useAdminMutation(
    ({ id, acknowledgeStatutoryGap }: { id: string; acknowledgeStatutoryGap?: boolean }) =>
      apiClient.patch(`/workforce/payroll/runs/${id}/approve`, { acknowledgeStatutoryGap }),
    ['admin-hr'],
  );
}

export function useStatutoryRuleSets() {
  return useQuery({
    queryKey: ['admin-hr', 'statutory'],
    queryFn: () => apiClient.get<StatutoryRuleSetRow[]>('/workforce/payroll/statutory-rules'),
  });
}

export function useIncentiveRuns(params: { clinicId?: string; year?: number }) {
  return useQuery({
    queryKey: ['admin-hr', 'incentive-runs', params],
    queryFn: () => apiClient.get<IncentiveRunRow[]>(`/workforce/incentives/runs${qs(params)}`),
  });
}

export function useIncentiveRun(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-hr', 'incentive-run', id],
    queryFn: () => apiClient.get<IncentiveRunDetail>(`/workforce/incentives/runs/${id}`),
    enabled: Boolean(id),
  });
}

export function useCalculateIncentives() {
  return useAdminMutation(
    (body: { period: string; clinicId?: string }) => apiClient.post('/workforce/incentives/calculate', body),
    ['admin-hr'],
  );
}

export function useIncentiveRules() {
  return useQuery({
    queryKey: ['admin-hr', 'incentive-rules'],
    queryFn: () => apiClient.get<Record<string, unknown>[]>('/workforce/incentives/rules'),
  });
}

// ---------------------------------------------------------------------------
// OPERATIONS
// ---------------------------------------------------------------------------

export function useOperationsOverview(params: { clinicId?: string; preset?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['admin-ops', 'overview', params],
    queryFn: () => apiClient.get<OperationsOverview>(`/operations/overview${qs(params)}`),
  });
}

export function useSegmentPl(params: { from: string; to: string; clinicId?: string }) {
  return useQuery({
    queryKey: ['admin-ops', 'segment-pl', params],
    queryFn: () => apiClient.get<SegmentPl>(`/operations/segments/profit-and-loss${qs(params)}`),
    enabled: Boolean(params.from && params.to),
  });
}

export function useSegments() {
  return useQuery({
    queryKey: ['admin-ops', 'segments'],
    queryFn: () => apiClient.get<Record<string, unknown>[]>('/operations/segments'),
  });
}

export function useProgrammes() {
  return useQuery({
    queryKey: ['admin-ops', 'programmes'],
    queryFn: () => apiClient.get<ProgrammeRow[]>('/operations/programmes'),
  });
}

export function useProgrammeDashboard(id: string | undefined, params: { from: string; to: string; clinicId?: string }) {
  return useQuery({
    queryKey: ['admin-ops', 'programme-dashboard', id, params],
    queryFn: () => apiClient.get<ProgrammeDashboard>(`/operations/programmes/${id}/dashboard${qs(params)}`),
    enabled: Boolean(id && params.from && params.to),
  });
}

export function useMarketingAudience(params: Record<string, string | number | undefined>, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-ops', 'audience', params],
    queryFn: () => apiClient.get<MarketingAudienceResult>(`/operations/marketing/audience${qs(params)}`),
    enabled,
  });
}

export function useMarketingTemplates() {
  return useQuery({
    queryKey: ['admin-ops', 'templates'],
    queryFn: () => apiClient.get<MarketingTemplateRow[]>('/operations/marketing/templates'),
  });
}

export function useMarketingHistory(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['admin-ops', 'marketing-history', params],
    queryFn: () => apiClient.get<MarketingHistory>(`/operations/marketing/history${qs(params)}`),
  });
}

// ---------------------------------------------------------------------------
// PROFITABILITY & BENEFITS
// ---------------------------------------------------------------------------

export function useProfitability(params: { from: string; to: string; clinicId?: string; kind?: string }) {
  return useQuery({
    queryKey: ['admin-finance', 'profitability', params],
    queryFn: () => apiClient.get<ProfitabilityReport>(`/finance/profitability${qs(params)}`),
  });
}

export function useStaffBenefits(params: { year?: number; clinicId?: string }) {
  return useQuery({
    queryKey: ['admin-hr', 'benefits', params],
    queryFn: () => apiClient.get<StaffBenefitReport>(`/workforce/benefits${qs(params)}`),
  });
}

export function useEmployeeRecord(staffId: string | undefined, year?: number) {
  return useQuery({
    queryKey: ['admin-hr', 'employee-record', staffId, year],
    queryFn: () => apiClient.get<EmployeeRecord>(`/workforce/employees/${staffId}/record${qs({ year })}`),
    enabled: Boolean(staffId),
  });
}

/**
 * PREPARE A MESSAGE PER PATIENT — and nothing further.
 *
 * The server builds the text and a wa.me link; a staff member clicks it and
 * sends it in WhatsApp themselves. `useMarkDispatchOpened` records THAT CLICK,
 * which is the last event this system can honestly observe. There is no send
 * mutation here because there is no sending.
 */
export function usePrepareDispatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { templateId: string; patientIds: string[]; clinicId?: string; audienceName?: string }) =>
      apiClient.post<PreparedDispatchResult>('/operations/marketing/prepare', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin-ops', 'marketing-history'] }),
  });
}

export function useMarkDispatchOpened() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dispatchId: string) => apiClient.patch(`/operations/marketing/dispatches/${dispatchId}/opened`, {}),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin-ops', 'marketing-history'] }),
  });
}
