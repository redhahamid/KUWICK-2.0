import { describe, expect, it } from 'vitest';
// Vite's ?raw import gives the file's SOURCE as a string, so these assertions
// run against what is actually compiled rather than a path guess.
import summarySource from './InvoiceSummary.tsx?raw';
import sectionSource from '../sections/InvoiceSection.tsx?raw';
import { Invoice, Visit } from '../types';
import {
  billingClassification,
  collapsedSummary,
  currentClaim,
  invoiceMoney,
  lineSource,
  money,
} from './invoicePresentation';

const VISIT = {
  id: 'visit-1',
  billingType: 'Cash',
  panelClinicId: null,
} as unknown as Visit;

const PANEL_VISIT = {
  id: 'visit-2',
  billingType: 'Panel',
  panelClinicId: 'panel-1',
  panelClinic: { id: 'panel-1', name: 'AIA' },
} as unknown as Visit;

const BASE: Invoice = {
  id: 'inv-1',
  visitId: 'visit-1',
  invoiceNumber: 'INV-000124',
  status: 'UNPAID',
  totalAmount: '85.00',
  createdByStaffId: 'staff-1',
  cancelReason: null,
  paidAt: null,
  paymentMethod: null,
  panelCoveredAmount: '0',
  patientPaidAmount: '0',
  createdAt: '2026-08-02T09:00:00.000Z',
  updatedAt: '2026-08-02T09:00:00.000Z',
  lines: [],
};

describe('money', () => {
  it('always shows two decimals with the currency', () => {
    expect(money('85')).toBe('RM 85.00');
    expect(money(0)).toBe('RM 0.00');
    expect(money(null)).toBe('RM 0.00');
  });
});

describe('invoiceMoney', () => {
  it('an unpaid invoice is entirely outstanding', () => {
    const m = invoiceMoney(BASE);
    expect(m.total).toBe(85);
    expect(m.received).toBe(0);
    expect(m.outstanding).toBe(85);
  });

  // panelCoveredAmount/patientPaidAmount are snapshotted at PAY time and are
  // 0/0 while unpaid. Reporting "Panel covered RM0.00" on an unpaid panel
  // invoice would read as "the panel pays nothing", which is false.
  it('does not report a panel/patient split before the invoice is paid', () => {
    expect(invoiceMoney(BASE).split).toBeNull();
  });

  it('a paid invoice is fully received with nothing outstanding', () => {
    const m = invoiceMoney({ ...BASE, status: 'PAID', patientPaidAmount: '85.00', paidAt: 'x' });
    expect(m.received).toBe(85);
    expect(m.outstanding).toBe(0);
  });

  it('a paid panel invoice reports the recorded split', () => {
    const m = invoiceMoney({
      ...BASE,
      status: 'PAID',
      totalAmount: '120.00',
      panelCoveredAmount: '100.00',
      patientPaidAmount: '20.00',
    });
    expect(m.split).toEqual({ panelCovered: 100, patientPaid: 20 });
    expect(m.received).toBe(120);
    expect(m.outstanding).toBe(0);
  });

  it('a cancelled invoice is not money owed', () => {
    const m = invoiceMoney({ ...BASE, status: 'CANCELLED' });
    expect(m.outstanding).toBe(0);
  });

  // The backend recalculates totalAmount from the lines; the frontend must
  // not produce a second, independently-derived figure.
  it('uses the backend total rather than re-summing the lines', () => {
    const m = invoiceMoney({
      ...BASE,
      totalAmount: '85.00',
      lines: [
        { id: 'l1', invoiceId: 'inv-1', description: 'A', quantity: 1, unitPrice: '10.00', amount: '10.00', sourceOrderServiceId: null, sourcePrescriptionId: null, excludedFromPanel: false, createdAt: 'x' },
      ],
    });
    expect(m.total).toBe(85);
  });
});

describe('billingClassification', () => {
  it('classifies a self-pay visit as Cash', () => {
    expect(billingClassification(BASE, VISIT)).toEqual({ isPanel: false, label: 'Cash', panelName: null });
  });

  it('names the panel when the visit has one', () => {
    const result = billingClassification(BASE, PANEL_VISIT);
    expect(result.isPanel).toBe(true);
    expect(result.label).toBe('Panel · AIA');
  });

  it('prefers the panel resolved on the invoice’s own visit', () => {
    const withVisit = {
      ...BASE,
      visit: { id: 'v', panelClinicId: 'p9', panelClinic: { id: 'p9', name: 'MARA' } },
    } as unknown as Invoice;
    expect(billingClassification(withVisit, VISIT).label).toBe('Panel · MARA');
  });
});

describe('lineSource', () => {
  const line = {
    id: 'l1',
    invoiceId: 'inv-1',
    description: 'Panadol 500mg',
    quantity: 1,
    unitPrice: '5.00',
    amount: '5.00',
    sourceOrderServiceId: null,
    sourcePrescriptionId: null,
    excludedFromPanel: false,
    createdAt: 'x',
  };

  it('reads Medication from the stored prescription link', () => {
    expect(lineSource({ ...line, sourcePrescription: { id: 'p1', itemId: 'i1', status: 'DISPENSED' } } as never).label).toBe(
      'Medication',
    );
  });

  it('distinguishes a procedure from a service by the order type', () => {
    expect(
      lineSource({
        ...line,
        sourceOrderService: { id: 'o1', procedureName: 'X-Ray', orderType: 'TASK_ORDER', status: 'COMPLETED' },
      } as never).label,
    ).toBe('Procedure');
    expect(
      lineSource({
        ...line,
        sourceOrderService: { id: 'o2', procedureName: 'Consultation', orderType: 'STANDARD_SERVICE', status: 'COMPLETED' },
      } as never).label,
    ).toBe('Service');
  });

  // "Panadol" in a description does not make a line a medication.
  it('never infers a source from the description text', () => {
    expect(lineSource(line as never)).toEqual({ kind: null, label: null, color: null });
  });
});

describe('collapsedSummary', () => {
  it('is empty when the visit has no invoice', () => {
    expect(collapsedSummary([], VISIT)).toBe('');
  });

  it('reads "Invoice INV-000124 · RM 85.00 · Unpaid · Cash"', () => {
    expect(collapsedSummary([BASE], VISIT)).toBe('Invoice INV-000124 · RM 85.00 · Unpaid · Cash');
  });

  it('names the panel for a panel invoice', () => {
    expect(collapsedSummary([{ ...BASE, totalAmount: '120.00' }], PANEL_VISIT)).toBe(
      'Invoice INV-000124 · RM 120.00 · Unpaid · Panel · AIA',
    );
  });

  // The schema has no unique constraint on visitId, so a visit really can
  // carry more than one invoice; silently reporting only the newest would
  // understate what the patient owes.
  it('says so when the visit carries more than one invoice', () => {
    expect(collapsedSummary([BASE, { ...BASE, id: 'inv-2' }], VISIT)).toContain('+1 more on this visit');
  });
});

describe('currentClaim', () => {
  it('is null when the invoice was never claimed', () => {
    expect(currentClaim(BASE)).toBeNull();
  });

  it('returns the most recent claim line', () => {
    const claimed = { ...BASE, claimBatchLines: [{ id: 'c1', status: 'PENDING' as const, claimedAmount: '100', paidAmount: null }] };
    expect(currentClaim(claimed)?.status).toBe('PENDING');
  });
});

// §2 / §11 — the requirement is that the Clinical Workspace has no financial
// mutation controls AT ALL, not that they are hidden. Asserted against the
// source so a future edit that re-imports one fails here.
describe('the Clinical Workspace mounts no financial mutation', () => {
  // Comments are stripped first: this file's own prose names the hooks in
  // order to explain why they are absent, and a scan that counted those
  // would pass or fail for the wrong reason. Only real code is examined.
  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const SURFACES: [string, string][] = [
    ['InvoiceSummary', summarySource],
    ['InvoiceSection', sectionSource],
  ];

  const MUTATION_HOOKS = [
    'useCreateInvoice',
    'useAddInvoiceLine',
    'useRemoveInvoiceLine',
    'useCancelInvoice',
    'usePayInvoice',
  ];

  it.each(SURFACES)('%s imports no invoice mutation hook', (_name, source) => {
    for (const hook of MUTATION_HOOKS) {
      expect(code(source)).not.toContain(hook);
    }
  });

  it.each(SURFACES)('%s does not mount the mutable InvoiceTab', (_name, source) => {
    expect(code(source)).not.toContain('InvoiceTab');
  });

  it('the summary renders no Pay, Cancel, Refund or Quick Add control', () => {
    for (const label of ['Mark Paid', 'Quick Add', 'Cancel Invoice', 'Refund', 'Add Line']) {
      expect(code(summarySource)).not.toContain(label);
    }
  });
});
