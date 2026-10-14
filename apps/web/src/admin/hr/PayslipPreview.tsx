import { useEffect, useRef, useState } from 'react';
import { App, Grid, Select } from 'antd';
import dayjs from 'dayjs';
import { downloadFile } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';
import { money } from '../components/DataTable';
import { payslipPreviewAllPath, payslipPreviewPdfPath, useMarkPayslipChecked, usePayslipPreview } from '../hooks/useAdmin';
import { PayslipPdfCanvas } from './PayslipPdfCanvas';
import { IconDownload } from './ui/icons';
import { TableModal } from './ui/TableModal';

/**
 * PREVIEW PAYSLIPS (UAT, 14 October 2026): "so payslips can be reviewed
 * without downloading each PDF". On Review it shows the draft, watermarked
 * DRAFT by the server; on Pay, the approved payslips. One at a time, exactly
 * as the PDF prints, with Previous / Next, the arrow keys, a swipe on a phone
 * and a list of names to jump to.
 *
 * "MARK AS CHECKED" is its own record, one per person per month. The review's
 * existing "Mark as checked" only acknowledges that person's warnings, so it
 * is not reused here. A check holds at the figures it was made at: when the
 * gross or net moves afterwards the payslip counts as unchecked again and says
 * why. Every figure on screen is the server's.
 */
export function PayslipPreviewButton({ runId, label = 'Preview payslips' }: { runId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="hr-btn hr-btn--sm" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? <PayslipPreview runId={runId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const SWIPE = 50;

export function PayslipPreview({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const wide = screens.md ?? true;
  const query = usePayslipPreview(runId);
  const mark = useMarkPayslipChecked();
  const mayRun = useCan('hr.payroll.run');
  const mayApprove = useCan('hr.payroll.approve');
  const mayCheck = mayRun || mayApprove;
  const [index, setIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const data = query.data;
  const slips = data?.payslips ?? [];
  const total = slips.length;
  const at = Math.min(index, Math.max(total - 1, 0));
  const slip = slips[at];

  const go = (next: number) => {
    if (total === 0) return;
    setIndex(Math.max(0, Math.min(total - 1, next)));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest('input, textarea, select, [contenteditable="true"]') || target.closest('.ant-select'))) return;
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(0, current - 1));
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(Math.max(total - 1, 0), current + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  const period = data ? dayjs(`${data.period}-01`).format('MMMM YYYY') : '';
  const title = data ? `Payslips · ${period}` : 'Payslips';
  const sub = data ? (data.draft ? 'Draft: not approved, the figures may still change.' : data.revision ? `As approved · revision ${data.revision}` : undefined) : undefined;

  const downloadAll = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await downloadFile(payslipPreviewAllPath(runId), `payslips-${data.period}${data.draft ? '-DRAFT' : ''}.pdf`);
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : 'The payslips could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  };

  const toggleChecked = () => {
    if (!slip) return;
    const checked = !slip.checked;
    mark.mutate(
      { runId, staffId: slip.staffId, checked },
      {
        // Checked, on to the next one: twenty payslips is twenty clicks, not forty.
        onSuccess: () => {
          if (checked && at < total - 1) go(at + 1);
        },
        onError: (e) => message.error(e instanceof Error && e.message ? e.message : 'Could not save.'),
      },
    );
  };

  const nameList = (
    <ul className="hr-payslipPreview__names" aria-label="Payslips in this month">
      {slips.map((row, position) => (
        <li key={row.staffId}>
          <button
            type="button"
            aria-current={position === at ? 'true' : undefined}
            className={position === at ? 'is-current' : undefined}
            onClick={() => go(position)}
          >
            <span className="hr-payslipPreview__mark" aria-label={row.checked ? 'Checked' : row.changedSinceCheck ? 'Changed since checked' : 'Not checked'}>
              {row.checked ? '✓' : row.changedSinceCheck ? '!' : ''}
            </span>
            <span className="hr-payslipPreview__name">{row.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <TableModal open title={title} sub={sub} onClose={onClose}>
      {query.isError ? (
        <div className="hr-notice hr-notice--attn">
          {query.error instanceof Error ? query.error.message : 'The payslips could not be loaded.'}
        </div>
      ) : !data ? (
        <div className="hr-muted">Loading payslips…</div>
      ) : total === 0 ? (
        <div className="hr-muted">Nobody is paid this month, so there are no payslips.</div>
      ) : (
        <div className="hr-payslipPreview">
          <div className="hr-payslipPreview__bar">
            <span className="hr-strong" aria-live="polite">
              {data.checked} of {data.total} checked
            </span>
            {data.draft ? <span className="hr-payslipPreview__draft">DRAFT</span> : null}
            <button type="button" className="hr-btn hr-btn--sm" onClick={downloadAll} disabled={downloading}>
              <IconDownload /> {downloading ? 'Preparing…' : 'Download all'}
            </button>
          </div>
          <div className="hr-payslipPreview__body">
            {wide ? <aside className="hr-payslipPreview__side">{nameList}</aside> : null}
            <section className="hr-payslipPreview__main">
              {!wide ? (
                <Select
                  aria-label="Jump to"
                  value={slip?.staffId}
                  onChange={(staffId: string) => go(slips.findIndex((row) => row.staffId === staffId))}
                  options={slips.map((row) => ({ value: row.staffId, label: `${row.checked ? '✓ ' : ''}${row.name}` }))}
                  style={{ width: '100%', marginBottom: 8 }}
                  showSearch={{ optionFilterProp: 'label' }}
                />
              ) : null}
              <div className="hr-payslipPreview__nav">
                <button type="button" className="hr-btn hr-btn--sm" onClick={() => go(at - 1)} disabled={at === 0}>
                  ‹ Previous
                </button>
                <span className="hr-strong">
                  {at + 1} of {total}
                </span>
                <button type="button" className="hr-btn hr-btn--sm" onClick={() => go(at + 1)} disabled={at >= total - 1}>
                  Next ›
                </button>
              </div>
              {slip ? (
                <div className="hr-payslipPreview__check">
                  <span>
                    <span className="hr-strong">{slip.name}</span>
                    {slip.employeeNo ? <span className="hr-muted"> · {slip.employeeNo}</span> : null}
                    <span className="hr-muted"> · net {money(slip.netCents / 100)}</span>
                  </span>
                  {slip.checked ? (
                    <span className="hr-payslipPreview__checkedBy">
                      ✓ Checked by {slip.checked.by}, {dayjs(slip.checked.at).format('D MMM YYYY, h:mm a')}
                    </span>
                  ) : slip.changedSinceCheck ? (
                    <span className="hr-payslipPreview__changed">Checked earlier, but the figures have changed since.</span>
                  ) : null}
                  {mayCheck ? (
                    <button
                      type="button"
                      className={slip.checked ? 'hr-btn hr-btn--sm hr-btn--ghost' : 'hr-btn hr-btn--sm hr-btn--primary'}
                      onClick={toggleChecked}
                      disabled={mark.isPending}
                    >
                      {slip.checked ? 'Undo checked' : 'Mark as checked'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div
                className="hr-payslipPreview__swipe"
                onTouchStart={(event) => {
                  const point = event.touches[0];
                  touch.current = point ? { x: point.clientX, y: point.clientY } : null;
                }}
                onTouchEnd={(event) => {
                  const start = touch.current;
                  const point = event.changedTouches[0];
                  touch.current = null;
                  if (!start || !point) return;
                  const dx = point.clientX - start.x;
                  const dy = point.clientY - start.y;
                  // Sideways and far enough: a swipe. Anything else is the page scrolling.
                  if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? at + 1 : at - 1);
                }}
              >
                {slip ? <PayslipPdfCanvas path={payslipPreviewPdfPath(runId, slip.staffId)} label={`Payslip of ${slip.name}`} /> : null}
              </div>
            </section>
          </div>
        </div>
      )}
    </TableModal>
  );
}
