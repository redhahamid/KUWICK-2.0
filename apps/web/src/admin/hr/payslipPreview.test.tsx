// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PayslipPreview as PreviewData } from '../types';

/*
 * PREVIEW PAYSLIPS (UAT, 14 October 2026): one payslip at a time, Previous /
 * Next, "3 of 20", arrow keys, a list of names, a swipe, "Mark as checked"
 * with its count, and "Download all". The PDF drawing is stood in: the screen
 * is what is under test. Demo people only.
 */
const { mutate, download, preview, screens } = vi.hoisted(() => ({
  mutate: vi.fn(),
  download: vi.fn(async () => undefined),
  preview: { data: undefined as unknown },
  screens: { md: true },
}));
vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<typeof import('antd')>();
  return { ...antd, Grid: { ...antd.Grid, useBreakpoint: () => screens } };
});
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  usePayslipPreview: () => ({ data: preview.data, isError: false, error: null }),
  useMarkPayslipChecked: () => ({ mutate, isPending: false }),
}));
vi.mock('../../core/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/api-client')>()),
  downloadFile: download,
}));
vi.mock('../../core/hooks/useCan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/hooks/useCan')>()),
  useCan: (permission: string) => permission === 'hr.payroll.run',
}));
vi.mock('./PayslipPdfCanvas', () => ({
  PayslipPdfCanvas: ({ path, label }: { path: string; label: string }) => <div data-testid="paper" data-path={path} aria-label={label} />,
}));

const { PayslipPreview } = await import('./PayslipPreview');

const person = (n: number, over: Partial<PreviewData['payslips'][number]> = {}) => ({
  staffId: `s-${n}`,
  name: `Demo Person ${n}`,
  employeeNo: `EM-${n}`,
  netCents: 250000 + n,
  checked: null,
  changedSinceCheck: false,
  ...over,
});
const data = (over: Partial<PreviewData> = {}): PreviewData => ({
  runId: 'run-8',
  period: '2026-08',
  draft: true,
  revision: null,
  payslips: [person(1, { checked: { by: 'Demo Owner', at: '2026-09-01T02:00:00.000Z' } }), person(2), person(3, { changedSinceCheck: true })],
  checked: 1,
  total: 3,
  ...over,
});

const mount = () =>
  render(
    <App>
      <div className="kw-hrSlate">
        <PayslipPreview runId="run-8" onClose={() => undefined} />
      </div>
    </App>,
  );
const paper = () => screen.getByTestId('paper').getAttribute('data-path');

describe('preview payslips', () => {
  beforeEach(() => {
    mutate.mockReset();
    download.mockClear();
    preview.data = data();
    screens.md = true;
  });

  it('pages through with the buttons, the arrow keys and the list of names', () => {
    mount();
    expect(screen.getByText('Payslips · August 2026')).toBeTruthy();
    expect(screen.getByText('DRAFT')).toBeTruthy();
    expect(screen.getByText('1 of 3 checked')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(paper()).toBe('/workforce/payroll/runs/run-8/payslip-preview/s-1/pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(paper()).toContain('/s-2/pdf');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('3 of 3')).toBeTruthy();
    expect(screen.getByText('Checked earlier, but the figures have changed since.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next ›' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('2 of 3')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('list', { name: 'Payslips in this month' })).getByText('Demo Person 1'));
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText(/Checked by Demo Owner/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹ Previous' }));
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('on a phone: a picker in place of the list, and a sideways swipe turns the page, not a scroll', () => {
    screens.md = false;
    mount();
    expect(screen.queryByRole('list', { name: 'Payslips in this month' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Jump to' })).toBeTruthy();
    const area = screen.getByTestId('paper').parentElement!;
    fireEvent.touchStart(area, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 180, clientY: 210 }] });
    expect(screen.getByText('2 of 3')).toBeTruthy();
    fireEvent.touchStart(area, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 240, clientY: 420 }] });
    expect(screen.getByText('2 of 3')).toBeTruthy();
    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 220, clientY: 200 }] });
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('marks a payslip as checked and moves on to the next one', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    mutate.mockImplementationOnce((_vars: unknown, handlers: { onSuccess: () => void }) => handlers.onSuccess());
    fireEvent.click(screen.getByRole('button', { name: 'Mark as checked' }));
    expect(mutate).toHaveBeenCalledWith({ runId: 'run-8', staffId: 's-2', checked: true }, expect.anything());
    expect(screen.getByText('3 of 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '‹ Previous' }));
    fireEvent.click(screen.getByRole('button', { name: '‹ Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo checked' }));
    expect(mutate).toHaveBeenLastCalledWith({ runId: 'run-8', staffId: 's-1', checked: false }, expect.anything());
  });

  it('downloads every payslip as one PDF, named for the month and DRAFT when it is one', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Download all/ }));
    expect(download).toHaveBeenCalledWith('/workforce/payroll/runs/run-8/payslip-preview/all.pdf', 'payslips-2026-08-DRAFT.pdf');
  });

  it('on the approved month says which revision and carries no DRAFT mark', () => {
    preview.data = data({ draft: false, revision: 2 });
    mount();
    expect(screen.getByText('As approved · revision 2')).toBeTruthy();
    expect(screen.queryByText('DRAFT')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Download all/ }));
    expect(download).toHaveBeenCalledWith('/workforce/payroll/runs/run-8/payslip-preview/all.pdf', 'payslips-2026-08.pdf');
  });
});
