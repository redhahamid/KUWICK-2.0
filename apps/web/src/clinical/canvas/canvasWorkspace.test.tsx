// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import { CanvasWorkspace } from './CanvasWorkspace';
import {
  CanvasVisitsRail,
  diagnosisSummary,
  medicationSummary,
  visitStamp,
} from './CanvasVisitsRail';
import {
  DEFAULT_RECORD_VIEW_LAYOUT,
  selectLayout,
  useRecordViewLayoutStore,
} from '../record-view-layout-store';
import { Visit, VisitHistorySummary } from '../types';

// ===========================================================================
// KUWICK 2.0 CANVAS — PHASE 1 SHELL
//
// The shell places three slots and owns no clinical rules. What these tests
// hold: that all three slots really render, that the visits rail can only
// read, and that the Flow|Canvas preference belongs to a person rather than
// to a shared clinic desktop.
// ===========================================================================

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: del },
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const VISIT = {
  id: 'visit-today',
  visitNumber: 'V-000004',
  checkInAt: '2026-08-09T09:59:00.000Z',
  checkOutAt: null,
  presentingComplaint: 'Fever & productive cough ×3 days',
} as Visit;

const pastVisit = (over: Partial<VisitHistorySummary> = {}): VisitHistorySummary =>
  ({
    id: 'visit-3',
    visitNumber: 'V-000003',
    checkInAt: '2026-08-04T02:18:00.000Z',
    checkOutAt: '2026-08-04T03:00:00.000Z',
    primaryDiagnosis: { name: 'URTI', icd10Code: 'J06.9', isPrimary: true },
    diagnosisCount: 1,
    medications: [{ name: 'PCM' }, { name: 'Bromhexine' }],
    medicationCount: 2,
    ...over,
  }) as VisitHistorySummary;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  get.mockResolvedValue({ items: [], total: 0 });
});

describe('the three-column shell', () => {
  it('1. renders all three slots', () => {
    render(
      <CanvasWorkspace
        visits={<div>history here</div>}
        middle={<div>the note</div>}
        right={<div>orders and meds</div>}
      />,
    );
    expect(screen.getByText('history here')).toBeInTheDocument();
    expect(screen.getByText('the note')).toBeInTheDocument();
    expect(screen.getByText('orders and meds')).toBeInTheDocument();
  });

  it('2. each slot lands in ITS OWN column, not nested in another', () => {
    // The columns are sized independently; nesting one inside another would
    // make the widths meaningless.
    render(<CanvasWorkspace visits={<div>H</div>} middle={<div>M</div>} right={<div>R</div>} />);
    const visits = screen.getByTestId('canvas-visits');
    const middle = screen.getByTestId('canvas-middle');
    const right = screen.getByTestId('canvas-right');
    expect(within(visits).getByText('H')).toBeInTheDocument();
    expect(within(middle).getByText('M')).toBeInTheDocument();
    expect(within(right).getByText('R')).toBeInTheDocument();
    expect(visits.contains(middle)).toBe(false);
    expect(middle.contains(right)).toBe(false);
  });

  it('3. the rails are landmarks a screen reader can jump to', () => {
    render(<CanvasWorkspace visits={<div>H</div>} middle={<div>M</div>} right={<div>R</div>} />);
    expect(screen.getByRole('complementary', { name: 'Visit history' })).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'Orders, medications and invoice' }),
    ).toBeInTheDocument();
  });

  it('4. the footer spans the columns rather than sitting inside one', () => {
    render(
      <CanvasWorkspace
        visits={<div>H</div>}
        middle={<div>M</div>}
        right={<div>R</div>}
        footer={<div>completion bar</div>}
      />,
    );
    const shell = screen.getByTestId('canvas-shell');
    expect(shell.contains(screen.getByText('completion bar'))).toBe(false);
  });

  it('5. it survives a browser with no ResizeObserver', () => {
    // jsdom has none, and neither did Safari until recently. Falling back to
    // the resize event keeps the layout live instead of frozen at first paint.
    const original = globalThis.ResizeObserver;
    // @ts-expect-error — deliberately removing it for this test.
    delete globalThis.ResizeObserver;
    expect(() =>
      render(<CanvasWorkspace visits={<div>H</div>} middle={<div>M</div>} right={<div>R</div>} />),
    ).not.toThrow();
    globalThis.ResizeObserver = original;
  });
});

describe('the visits rail', () => {
  const renderRail = (onOpenHistory = vi.fn()) => {
    render(
      <Harness>
        <CanvasVisitsRail
          patientId="patient-1"
          currentVisit={VISIT}
          onOpenHistory={onOpenHistory}
        />
      </Harness>,
    );
    return onOpenHistory;
  };

  it('6. today’s visit is on screen with its state', async () => {
    renderRail();
    const today = await screen.findByTestId('canvas-visit-today');
    expect(within(today).getByText('V-000004')).toBeInTheDocument();
    expect(within(today).getByText('IN CONSULT')).toBeInTheDocument();
  });

  it('7. a first visit says so instead of leaving a blank column', async () => {
    // Spec p.3 — a first visit is a state, not an error.
    renderRail();
    expect(await screen.findByTestId('canvas-visits-empty')).toHaveTextContent('First visit');
  });

  it('8. past visits show their diagnosis and prescription at a glance', async () => {
    get.mockResolvedValue({ items: [pastVisit()], total: 1 });
    renderRail();
    const past = await screen.findByTestId('canvas-visit-past');
    expect(within(past).getByText(/URTI \(J06.9\)/)).toBeInTheDocument();
    expect(within(past).getByText(/PCM · Bromhexine/)).toBeInTheDocument();
  });

  it('9. the visit being documented is NEVER listed as a past visit', async () => {
    get.mockResolvedValue({
      items: [pastVisit(), pastVisit({ id: 'visit-today', visitNumber: 'V-000004' })],
      total: 2,
    });
    renderRail();
    await screen.findByTestId('canvas-visit-past');
    expect(screen.getAllByTestId('canvas-visit-past')).toHaveLength(1);
  });

  it('10. it can only READ — no mutation reaches the API', async () => {
    // The consultation in progress must be untouchable from this column.
    get.mockResolvedValue({ items: [pastVisit()], total: 1 });
    renderRail();
    await screen.findByTestId('canvas-visit-past');
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('11. it reads history caches only, never the live visit’s', async () => {
    get.mockResolvedValue({ items: [pastVisit()], total: 1 });
    renderRail();
    await waitFor(() => expect(get).toHaveBeenCalled());
    for (const [url] of get.mock.calls) {
      // History endpoints only. A read of /visits, /clinical-notes or
      // /prescriptions from this column could refresh the doctor's open
      // consultation out from under them (D-067).
      expect(String(url)).toContain('history');
    }
  });
});

describe('the rail’s pure helpers', () => {
  it('12. stamps today as "Today" and older visits by date', () => {
    const today = new Date('2026-08-09T12:00:00.000Z');
    expect(visitStamp('2026-08-09T09:59:00.000Z', dayjs(today))).toMatch(/^Today · \d{2}:\d{2}$/);
    expect(visitStamp('2026-08-04T02:18:00.000Z', dayjs(today))).toMatch(/^4 Aug · \d{2}:\d{2}$/);
  });

  it('13. an unrecorded diagnosis says so rather than showing blank', () => {
    expect(diagnosisSummary(pastVisit({ primaryDiagnosis: null }))).toBe('— not recorded');
  });

  it('14. extra diagnoses and medicines are counted, not silently dropped', () => {
    expect(diagnosisSummary(pastVisit({ diagnosisCount: 3 }))).toBe('URTI (J06.9) +2');
    expect(
      medicationSummary(pastVisit({ medications: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] as never })),
    ).toBe('A · B +1');
  });

  it('15. a visit with no medication shows a dash, not an empty line', () => {
    expect(medicationSummary(pastVisit({ medications: [] }))).toBe('—');
  });
});

describe('the Flow|Canvas preference belongs to a PERSON', () => {
  beforeEach(() => {
    useRecordViewLayoutStore.setState({ byStaffId: {}, anonymous: DEFAULT_RECORD_VIEW_LAYOUT });
  });

  it('16. two staff on one shared desktop keep different layouts', () => {
    // A consultation-room PC is shared: a doctor who works in Canvas, a
    // locum who prefers Flow. One value meant each changed it for the other.
    const { setLayoutFor } = useRecordViewLayoutStore.getState();
    setLayoutFor('staff-doctor', 'canvas');
    setLayoutFor('staff-locum', 'flow');

    const state = useRecordViewLayoutStore.getState();
    expect(selectLayout(state, 'staff-doctor')).toBe('canvas');
    expect(selectLayout(state, 'staff-locum')).toBe('flow');
  });

  it('17. a staff member who has never chosen gets the default', () => {
    expect(selectLayout(useRecordViewLayoutStore.getState(), 'staff-new')).toBe(
      DEFAULT_RECORD_VIEW_LAYOUT,
    );
  });

  it('18. a signed-out session does not write into anyone’s preference', () => {
    useRecordViewLayoutStore.getState().setLayoutFor(undefined, 'canvas');
    const state = useRecordViewLayoutStore.getState();
    expect(state.byStaffId).toEqual({});
    expect(selectLayout(state, undefined)).toBe('canvas');
  });
});
