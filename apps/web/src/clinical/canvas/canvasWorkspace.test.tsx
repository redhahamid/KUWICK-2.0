// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  // URL-aware: the rail reads history AND today's diagnoses/prescriptions/
  // orders, and those return arrays rather than a page.
  get.mockImplementation(async (url: string) =>
    String(url).includes('history') ? { items: [], total: 0 } : [],
  );
});

/** History page + empty live-visit reads. */
const historyReturning = (items: VisitHistorySummary[]) =>
  get.mockImplementation(async (url: string) =>
    String(url).includes('history') ? { items, total: items.length } : [],
  );

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
    historyReturning([pastVisit()]);
    renderRail();
    const past = await screen.findByTestId('canvas-visit-past');
    expect(within(past).getByText(/URTI \(J06.9\)/)).toBeInTheDocument();
    expect(within(past).getByText(/PCM · Bromhexine/)).toBeInTheDocument();
  });

  it('9. the visit being documented is NEVER listed as a past visit', async () => {
    historyReturning([pastVisit(), pastVisit({ id: 'visit-today', visitNumber: 'V-000004' })]);
    renderRail();
    await screen.findByTestId('canvas-visit-past');
    expect(screen.getAllByTestId('canvas-visit-past')).toHaveLength(1);
  });

  it('10. it can only READ — no mutation reaches the API', async () => {
    // The consultation in progress must be untouchable from this column.
    historyReturning([pastVisit()]);
    renderRail();
    await screen.findByTestId('canvas-visit-past');
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('11. it NEVER reads a clinical note', async () => {
    // Today's card carries the same Dx/Rx/Or facts the past cards do, so the
    // rail does read the live visit's diagnoses, prescriptions and orders —
    // caches the middle and right columns already populate, so no extra
    // request. The note is the one thing it must never touch: fetching it
    // here is what remounts the editor and loses a draft (C1/D-091).
    historyReturning([pastVisit()]);
    renderRail();
    await waitFor(() => expect(get).toHaveBeenCalled());
    for (const [url] of get.mock.calls) {
      expect(String(url)).not.toContain('clinical-note');
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

describe('history compresses, it never disappears', () => {
  /**
   * jsdom reports every element as 0px wide, so the shell would always
   * measure as "stacked". Pinning clientWidth is what lets these tests stand
   * at a real breakpoint.
   */
  const atWidth = (width: number) =>
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);

  const renderAt = (width: number) => {
    const spy = atWidth(width);
    const result = render(
      <CanvasWorkspace
        visits={<div>the visits rail</div>}
        middle={<div>M</div>}
        right={<div>R</div>}
      />,
    );
    return { ...result, spy };
  };

  it('19. at 1180 the rail folds and an edge tab takes its place', async () => {
    const { spy } = renderAt(1180);
    await waitFor(() =>
      expect(screen.getByTestId('canvas-shell')).toHaveAttribute('data-mode', 'two-column'),
    );
    expect(screen.getByTestId('canvas-history-tab')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('20. the tab opens the SAME history content as an overlay', async () => {
    const { spy } = renderAt(1180);
    await screen.findByTestId('canvas-history-tab');
    await userEvent.click(screen.getByTestId('canvas-history-tab'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(within(screen.getByRole('dialog')).getByText('the visits rail')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('21. Escape closes it — a doctor mid-consult should not have to aim', async () => {
    const { spy } = renderAt(1180);
    await screen.findByTestId('canvas-history-tab');
    await userEvent.click(screen.getByTestId('canvas-history-tab'));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    spy.mockRestore();
  });

  it('22. the close control dismisses it too', async () => {
    const { spy } = renderAt(1180);
    await screen.findByTestId('canvas-history-tab');
    await userEvent.click(screen.getByTestId('canvas-history-tab'));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    spy.mockRestore();
  });

  it('23. at 1440 the rail is on screen, so there is no tab to duplicate it', async () => {
    const { spy } = renderAt(1440);
    await waitFor(() =>
      expect(screen.getByTestId('canvas-shell')).toHaveAttribute('data-mode', 'three-column'),
    );
    expect(screen.queryByTestId('canvas-history-tab')).not.toBeInTheDocument();
    expect(screen.getByText('the visits rail')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('24. stacked keeps the rail on the page, so no tab there either', async () => {
    // Ordered below the work rather than removed — a second way in would be a
    // duplicate control, not a rescue.
    const { spy } = renderAt(390);
    await waitFor(() =>
      expect(screen.getByTestId('canvas-shell')).toHaveAttribute('data-mode', 'stacked'),
    );
    expect(screen.queryByTestId('canvas-history-tab')).not.toBeInTheDocument();
    expect(screen.getByText('the visits rail')).toBeInTheDocument();
    spy.mockRestore();
  });
});

// ===========================================================================
// KW2-C2 — "hover any visit = note preview" (spec p.2)
//
// The rule the delay exists for: a pointer travelling to the note crosses
// every card in the rail, and a preview that opens on contact would fire a
// request and flash a panel for each one.
// ===========================================================================
describe('the past-visit hover preview', () => {
  const DETAIL = {
    notes: [
      {
        id: 'note-1',
        noteType: 'DOCTOR_NARRATIVE',
        entryType: 'STANDARD',
        status: 'SIGNED',
        notes: '<p>Fever ×3 days, productive cough. Chest clear.</p>',
        authorNameSnapshot: 'Dr Amira Rahman',
        clinicalEntryAt: '2026-08-04T02:20:00.000Z',
        updatedAt: '2026-08-04T02:25:00.000Z',
      },
    ],
  };

  const withDetail = (items: VisitHistorySummary[]) =>
    get.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.match(/\/history\/[^?]+$/)) return DETAIL;
      if (path.includes('history')) return { items, total: items.length };
      return [];
    });

  const renderRail = () =>
    render(
      <Harness>
        <CanvasVisitsRail patientId="patient-1" currentVisit={VISIT} onOpenHistory={vi.fn()} />
      </Harness>,
    );

  const detailCalls = () =>
    get.mock.calls.filter(([url]) => String(url).match(/\/history\/[^?]+$/));

  it('nothing opens on contact — the pause is the point', async () => {
    withDetail([pastVisit()]);
    renderRail();
    const card = await screen.findByTestId('canvas-visit-past');

    fireEvent.mouseEnter(card);
    // Immediately after entering: no panel, and no request issued for it.
    expect(screen.queryByTestId('canvas-visit-preview')).not.toBeInTheDocument();
    expect(detailCalls()).toHaveLength(0);
  });

  it('a deliberate hover opens it, from the visit detail endpoint', async () => {
    withDetail([pastVisit()]);
    renderRail();
    fireEvent.mouseEnter(await screen.findByTestId('canvas-visit-past'));

    const panel = await screen.findByTestId('canvas-visit-preview');
    expect(await within(panel).findByText(/Fever ×3 days/)).toBeInTheDocument();
    expect(within(panel).getByText(/Dr Amira Rahman/)).toBeInTheDocument();
    expect(detailCalls()).toHaveLength(1);
    expect(String(detailCalls()[0][0])).toBe('/patients/patient-1/history/visit-3');
  });

  it('a pointer passing across the rail opens ONE preview, not four', async () => {
    withDetail([
      pastVisit({ id: 'visit-3' }),
      pastVisit({ id: 'visit-2', visitNumber: 'V-000002' }),
      pastVisit({ id: 'visit-1', visitNumber: 'V-000001' }),
    ]);
    renderRail();
    const cards = await screen.findAllByTestId('canvas-visit-past');

    // Crossing the first two on the way to the third.
    fireEvent.mouseEnter(cards[0]);
    fireEvent.mouseLeave(cards[0]);
    fireEvent.mouseEnter(cards[1]);
    fireEvent.mouseLeave(cards[1]);
    fireEvent.mouseEnter(cards[2]);

    await screen.findByTestId('canvas-visit-preview');
    expect(screen.getAllByTestId('canvas-visit-preview')).toHaveLength(1);
    await waitFor(() => expect(detailCalls()).toHaveLength(1));
    // The one the pointer STOPPED on, not the ones it crossed.
    expect(String(detailCalls()[0][0])).toBe('/patients/patient-1/history/visit-1');
  });

  it('leaving closes it at once — a panel must not follow the pointer', async () => {
    withDetail([pastVisit()]);
    renderRail();
    const card = await screen.findByTestId('canvas-visit-past');
    fireEvent.mouseEnter(card);
    await screen.findByTestId('canvas-visit-preview');

    fireEvent.mouseLeave(card);
    expect(screen.queryByTestId('canvas-visit-preview')).not.toBeInTheDocument();
  });

  it('a second look costs no second request — the visit is cached', async () => {
    withDetail([pastVisit()]);
    renderRail();
    const card = await screen.findByTestId('canvas-visit-past');

    fireEvent.mouseEnter(card);
    // Wait for the FIRST read to have actually happened, so a second one
    // would be visible rather than the assertion passing on an empty list.
    await within(await screen.findByTestId('canvas-visit-preview')).findByText(/Fever ×3 days/);
    expect(detailCalls()).toHaveLength(1);

    fireEvent.mouseLeave(card);
    fireEvent.mouseEnter(card);
    await within(await screen.findByTestId('canvas-visit-preview')).findByText(/Fever ×3 days/);
    expect(detailCalls()).toHaveLength(1);
  });

  it('the keyboard reaches it too', async () => {
    withDetail([pastVisit()]);
    renderRail();
    fireEvent.focus(await screen.findByTestId('canvas-visit-past'));
    expect(await screen.findByTestId('canvas-visit-preview')).toBeInTheDocument();
  });

  it('a DRAFT note is named, never quoted', async () => {
    // A preview has no room for the caveats the full history surface carries,
    // and an unsigned note is somebody mid-sentence.
    get.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.match(/\/history\/[^?]+$/)) {
        return { notes: [{ ...DETAIL.notes[0], status: 'DRAFT', notes: '<p>?viral, will review</p>' }] };
      }
      if (path.includes('history')) return { items: [pastVisit()], total: 1 };
      return [];
    });
    renderRail();
    fireEvent.mouseEnter(await screen.findByTestId('canvas-visit-past'));

    const panel = await screen.findByTestId('canvas-visit-preview');
    expect(await within(panel).findByText('Note not finalized for this visit.')).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/will review/);
  });

  it('a failed preview says so, and leaves the card’s own facts standing', async () => {
    get.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.match(/\/history\/[^?]+$/)) throw new Error('offline');
      if (path.includes('history')) return { items: [pastVisit()], total: 1 };
      return [];
    });
    renderRail();
    const card = await screen.findByTestId('canvas-visit-past');
    fireEvent.mouseEnter(card);

    const panel = await screen.findByTestId('canvas-visit-preview');
    await waitFor(() => expect(panel.textContent).toMatch(/Preview unavailable/));
    // Never "no note recorded" — the read failed, which is a different fact.
    expect(panel.textContent).not.toMatch(/No clinical note recorded/);
    expect(within(card).getByText(/URTI/)).toBeInTheDocument();
  });

  it('it reads and only reads — hovering issues no write of any kind', async () => {
    withDetail([pastVisit()]);
    renderRail();
    fireEvent.mouseEnter(await screen.findByTestId('canvas-visit-past'));
    await screen.findByTestId('canvas-visit-preview');

    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('it never touches the live consultation’s caches (C1/D-091)', async () => {
    // The preview reuses the read-only history query, whose keys live under
    // 'visit-history'. If a hover reached 'clinical-notes', the editor would
    // remount and an unsaved draft would go with it.
    withDetail([pastVisit()]);
    renderRail();
    fireEvent.mouseEnter(await screen.findByTestId('canvas-visit-past'));
    await screen.findByTestId('canvas-visit-preview');

    expect(get.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('clinical-notes'))).toEqual(
      [],
    );
  });
});
