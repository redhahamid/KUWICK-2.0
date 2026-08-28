// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, exportRowsAsCsv, money, moneyOrDash } from './DataTable';
import { AdminNotice, AdminSection, AdminShell } from './AdminShell';
import { ExceptionTiles, StatStrip } from './StatStrip';

describe('money formatting', () => {
  it('always shows two decimals with the sign in front', () => {
    expect(money(0)).toBe('RM0.00');
    expect(money(1234.5)).toBe('RM1234.50');
    expect(money(-42)).toBe('-RM42.00');
  });

  it('distinguishes ABSENT from ZERO — the distinction the whole programme runs on', () => {
    // A statutory contribution that was not computed and one that is genuinely
    // nil must never look the same on a payslip.
    expect(moneyOrDash(null)).toBe('—');
    expect(moneyOrDash(undefined)).toBe('—');
    expect(moneyOrDash(0)).toBe('RM0.00');
  });
});

describe('CSV export', () => {
  it('quotes every field and doubles internal quotes', () => {
    // A patient called O'Brien, a note containing a comma, and a description
    // containing a quote are all ordinary in a clinic. An export that corrupts
    // on any of them is an export nobody trusts.
    const clicked = vi.fn();
    const created: Record<string, unknown> = {};
    const anchor = { click: clicked, set href(value: string) { created.href = value; }, set download(value: string) { created.download = value; } };
    vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement);

    const captured: string[] = [];
    const originalBlob = globalThis.Blob;
    class CapturingBlob {
      constructor(parts: string[]) {
        captured.push(parts.join(''));
      }
    }
    globalThis.Blob = CapturingBlob as unknown as typeof Blob;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();

    exportRowsAsCsv(
      'patients',
      [{ name: 'Siti O"Brien', note: 'Late, rescheduled' }],
      [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Note', dataIndex: 'note', key: 'note' },
      ],
    );

    globalThis.Blob = originalBlob;
    vi.restoreAllMocks();

    expect(captured[0]).toContain('"Name","Note"');
    expect(captured[0]).toContain('"Siti O""Brien","Late, rescheduled"');
    expect(clicked).toHaveBeenCalled();
  });

  it('leaves out columns marked noExport — an action column is not data', () => {
    const captured: string[] = [];
    const originalBlob = globalThis.Blob;
    class CapturingBlob {
      constructor(parts: string[]) {
        captured.push(parts.join(''));
      }
    }
    globalThis.Blob = CapturingBlob as unknown as typeof Blob;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({ click: vi.fn(), href: '', download: '' } as unknown as HTMLAnchorElement);

    exportRowsAsCsv(
      'rows',
      [{ name: 'A' }],
      [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Actions', key: 'actions', noExport: true },
      ],
    );

    globalThis.Blob = originalBlob;
    vi.restoreAllMocks();
    expect(captured[0]).toContain('"Name"');
    expect(captured[0]).not.toContain('Actions');
  });
});

describe('DataTable', () => {
  it('renders an empty state with its hint rather than a bare blank', () => {
    render(
      <DataTable
        rows={[]}
        rowKey="id"
        columns={[{ title: 'Name', dataIndex: 'name', key: 'name' }]}
        emptyText="Nothing to show"
        emptyHint="This being empty is the state you want."
      />,
    );
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
    expect(screen.getByText('This being empty is the state you want.')).toBeInTheDocument();
  });

  it('hides optional columns by default so the default view stays readable', () => {
    render(
      <DataTable
        rows={[{ id: '1', name: 'Amoxicillin', batch: 'B-100' }]}
        rowKey="id"
        columns={[
          { title: 'Name', dataIndex: 'name', key: 'name' },
          { title: 'Batch', dataIndex: 'batch', key: 'batch', optional: true },
        ]}
      />,
    );
    expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
    expect(screen.queryByText('B-100')).not.toBeInTheDocument();
  });
});

describe('exception tiles', () => {
  it('keeps a ZERO tile visible and quiet — a tile that vanishes teaches people not to look', () => {
    const { container } = render(
      <ExceptionTiles
        tiles={[
          { key: 'expired', label: 'Expired', count: 0, tone: 'bad' },
          { key: 'negative', label: 'Negative stock', count: 3, tone: 'bad' },
        ]}
      />,
    );
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(container.querySelectorAll('.kw-exceptionTile--clean')).toHaveLength(1);
    expect(container.querySelectorAll('.kw-exceptionTile--bad')).toHaveLength(1);
  });
});

describe('the admin frame', () => {
  it('renders a notice as a permanent band, not a dismissible alert', () => {
    render(
      <AdminShell title="Finance" subtitle="Did yesterday reconcile?">
        <AdminNotice tone="warn">EPF was not calculated for this run.</AdminNotice>
        <AdminSection title="Runs">
          <StatStrip stats={[{ label: 'Net', value: 'RM1.00' }]} />
        </AdminSection>
      </AdminShell>,
    );
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('Did yesterday reconcile?')).toBeInTheDocument();
    expect(screen.getByText('EPF was not calculated for this run.')).toBeInTheDocument();
    // No close button: these are facts about the screen, not problems to dismiss.
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });
});
