import { useState } from 'react';
import { App, DatePicker, Input, InputNumber, Modal, Select, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { money } from '../components/DataTable';
import { PanelHead } from './ui';
import { Table } from './ui/Table';
import { IconPlus } from './ui/icons';
import { apiClient } from '../../core/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../core/hooks/useCan';

interface Tp1Row {
  id: string;
  period: string;
  deductionsCents: number;
  zakatSelfPaidCents: number;
  items: { label: string; amountCents: number }[] | null;
  receivedDate: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

interface Tp3Row {
  id: string;
  previousEmployerName: string;
  employmentFrom: string | null;
  employmentTo: string | null;
  grossCents: number;
  epfCents: number;
  mtdPaidCents: number;
  zakatCents: number;
  deductionsCents: number;
  source: string;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

interface TaxRecords {
  staffId: string;
  taxYear: number;
  tp1: Tp1Row[];
  tp3: Tp3Row[];
}

/**
 * TP1 AND TP3 — the two LHDN forms that change a month's tax.
 *
 * TP1 is the employer's approved figure off the employee's monthly claim; it
 * enters that month's MTD as LP1 and accumulates. TP3 is a mid-year joiner's
 * previous employment, feeding the cumulative accumulators. Both are records
 * with a name, a date and a source on them — and the server refuses what
 * would double-count or rewrite an approved month.
 */
export function EmployeeTaxPanel({ staffId }: { staffId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const mayRun = useCan('hr.payroll.run');
  // A picker, not `new Date()` alone: in January, last year's TP1/TP3 — the
  // records an assessment question is most likely to be about — were
  // unreachable, with nothing on screen to say another year existed.
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const query = useQuery({
    queryKey: ['admin-hr', 'tax-records', staffId, year],
    queryFn: () => apiClient.get<TaxRecords>(`/workforce/employees/${staffId}/tax-records?year=${year}`),
  });

  const [tp1Open, setTp1Open] = useState(false);
  const [tp3Open, setTp3Open] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // TP1 form state
  const [tp1Period, setTp1Period] = useState<Dayjs | null>(dayjs());
  const [tp1Amount, setTp1Amount] = useState<number | null>(null);
  const [tp1Zakat, setTp1Zakat] = useState<number | null>(null);
  const [tp1Items, setTp1Items] = useState('');
  const [tp1Received, setTp1Received] = useState<Dayjs | null>(dayjs());

  // TP3 form state
  const [tp3Employer, setTp3Employer] = useState('');
  const [tp3From, setTp3From] = useState<Dayjs | null>(null);
  const [tp3To, setTp3To] = useState<Dayjs | null>(null);
  const [tp3Gross, setTp3Gross] = useState<number | null>(null);
  const [tp3Epf, setTp3Epf] = useState<number | null>(null);
  const [tp3Mtd, setTp3Mtd] = useState<number | null>(null);
  const [tp3Zakat, setTp3Zakat] = useState<number | null>(null);
  const [tp3Lp, setTp3Lp] = useState<number | null>(null);
  const [tp3Source, setTp3Source] = useState('');

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-hr'] });
  const fail = (e: unknown) =>
    setError(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed');

  const data = query.data;

  const saveTp1 = () => {
    setError(null);
    if (!tp1Period) return setError('Which month does the form cover?');
    // Typed, never assumed: a blank box is not RM0.00. A TP1 recorded off an
    // untouched form would write "the employer approved RM0.00 of reliefs"
    // into the month — a statement nobody made.
    if (tp1Amount === null || tp1Amount === undefined) {
      return setError('Enter the month’s approved deductions off the form — RM0.00 only if the form really claims none.');
    }
    if (tp1Zakat === null || tp1Zakat === undefined) {
      return setError('Enter the self-paid zakat off the form — RM0.00 if the form claims none.');
    }
    if (tp1Amount === 0 && tp1Zakat === 0) {
      return setError('A TP1 claiming no deductions and no zakat changes nothing — there is nothing to record.');
    }
    const cents = Math.round(tp1Amount * 100);
    const zakatCents = Math.round(tp1Zakat * 100);
    // Items: one per line, "label amount" with the amount last.
    const items = tp1Items
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = /^(.*?)\s+([\d,]+(?:\.\d{1,2})?)$/.exec(line);
        return match
          ? { label: match[1].trim(), amountCents: Math.round(Number(match[2].replace(/,/g, '')) * 100) }
          : { label: line, amountCents: NaN };
      });
    if (items.some((item) => Number.isNaN(item.amountCents))) {
      return setError('Each itemised line needs the relief and its amount — e.g. "Medical treatment for parents 1,500.00".');
    }
    setSaving(true);
    apiClient
      .post(`/workforce/employees/${staffId}/tp1`, {
        period: tp1Period.format('YYYY-MM'),
        deductionsCents: cents,
        zakatSelfPaidCents: zakatCents,
        items: items.length > 0 ? items : undefined,
        receivedDate: tp1Received?.format('YYYY-MM-DD'),
      })
      .then(() => {
        message.success('TP1 recorded. Recalculate any open run for the month to apply it.');
        setTp1Open(false);
        refresh();
      })
      .catch(fail)
      .finally(() => setSaving(false));
  };

  const saveTp3 = () => {
    setError(null);
    // The three figures the cumulative method reads are typed off the form,
    // never assumed: `?? 0` here declared "the previous employer paid RM0
    // gross and deducted RM0 tax" for any box left untouched — feeding ∑Y,
    // ∑K and X with statements nobody made.
    if (tp3Employer.trim().length < 2) return setError('Name the previous employer as the form does.');
    if (tp3Gross === null || tp3Gross === undefined) {
      return setError('Enter the gross the previous employer paid, off the TP3.');
    }
    if (tp3Gross <= 0) return setError('A TP3 with no gross pay declares nothing — there is nothing to record.');
    if (tp3Epf === null || tp3Epf === undefined) {
      return setError('Enter the EPF the previous employer deducted — RM0.00 only if the form really says none.');
    }
    if (tp3Mtd === null || tp3Mtd === undefined) {
      return setError('Enter the MTD the previous employer deducted — RM0.00 only if the form really says none.');
    }
    if (tp3Source.trim().length < 5) {
      return setError('Say where the figures came from — “Borang TP3 dated 12 May 2026”, for instance.');
    }
    setSaving(true);
    apiClient
      .post(`/workforce/employees/${staffId}/tp3`, {
        taxYear: year,
        previousEmployerName: tp3Employer.trim(),
        employmentFrom: tp3From?.format('YYYY-MM-DD'),
        employmentTo: tp3To?.format('YYYY-MM-DD'),
        grossCents: Math.round(tp3Gross * 100),
        epfCents: Math.round(tp3Epf * 100),
        mtdPaidCents: Math.round(tp3Mtd * 100),
        // Genuinely optional on the form; left blank they are recorded as the
        // nils the form's own blanks mean.
        zakatCents: Math.round((tp3Zakat ?? 0) * 100),
        deductionsCents: Math.round((tp3Lp ?? 0) * 100),
        source: tp3Source.trim(),
      })
      .then(() => {
        message.success('TP3 recorded. It feeds every month calculated from now on.');
        setTp3Open(false);
        refresh();
      })
      .catch(fail)
      .finally(() => setSaving(false));
  };

  const remove = (kind: 'tp1' | 'tp3', id: string) => {
    Modal.confirm({
      title: `Delete this ${kind.toUpperCase()} record?`,
      content:
        kind === 'tp1'
          ? 'A month an approved run already applied it to will refuse. The deletion is audited.'
          : 'Months already approved keep the figures they were approved with; future months recalculate without it. The deletion is audited.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () =>
        apiClient
          .delete(`/workforce/payroll/${kind}/${id}`)
          .then(() => {
            message.success('Deleted.');
            refresh();
          })
          .catch((e) =>
            message.error(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed'),
          ),
    });
  };

  const field = (label: string, control: React.ReactNode, help?: string) => (
    <div>
      <label>{label}</label>
      {control}
      {help ? <div className="hr-form__help">{help}</div> : null}
    </div>
  );

  return (
    <>
      <PanelHead
        rule
        title={`TP1 — monthly deduction claims, ${year}`}
        sub="The employer's approved figure off the employee's Form TP1. It enters that month's tax as LP1; the relief catalogue's annual caps are not verified against LHDN, so approving the form remains the employer's own act."
        actions={
          <>
            <Select
              size="small"
              value={year}
              onChange={setYear}
              aria-label="Tax year"
              options={[currentYear, currentYear - 1, currentYear - 2].map((y) => ({ value: y, label: String(y) }))}
              style={{ width: 90 }}
            />
            {mayRun ? (
              <button type="button" className="hr-btn hr-btn--sm" onClick={() => { setError(null); setTp1Open(true); }}>
                <IconPlus />
                Record a TP1
              </button>
            ) : null}
          </>
        }
      />
      <Table<Tp1Row>
        rowKey="id"
        rows={data?.tp1 ?? []}
        loading={query.isLoading}
        emptyText="No TP1 has been recorded this year."
        emptyHint="Monthly tax is worked out as though none was filed — which is correct for an employee who filed none."
        columns={[
          { title: 'Month', dataIndex: 'period', width: 110, render: (value: string) => dayjs(`${value}-01`).format('MMM YYYY') },
          { title: 'Deductions (LP1)', key: 'lp1', num: true, width: 150, render: (_: unknown, row: Tp1Row) => money(row.deductionsCents / 100) },
          {
            title: 'Self-paid zakat',
            key: 'zakat',
            num: true,
            width: 140,
            render: (_: unknown, row: Tp1Row) => (row.zakatSelfPaidCents > 0 ? money(row.zakatSelfPaidCents / 100) : <span className="hr-faint">—</span>),
          },
          {
            title: 'Items',
            key: 'items',
            render: (_: unknown, row: Tp1Row) =>
              row.items ? <span className="hr-muted">{row.items.map((item) => item.label).join(' · ')}</span> : <span className="hr-faint">Total only</span>,
          },
          {
            title: 'Recorded',
            key: 'recorded',
            width: 170,
            render: (_: unknown, row: Tp1Row) => (
              <Tooltip title={row.receivedDate ? `Form received ${row.receivedDate}` : undefined}>
                <span className="hr-muted">
                  {row.recordedBy}, {dayjs(row.recordedAt).format('D MMM')}
                </span>
              </Tooltip>
            ),
          },
          {
            title: '',
            key: 'remove',
            width: 80,
            render: (_: unknown, row: Tp1Row) =>
              mayRun ? (
                <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" style={{ color: 'var(--hr-red)' }} onClick={() => remove('tp1', row.id)}>
                  Delete
                </button>
              ) : null,
          },
        ]}
      />

      <PanelHead
        rule
        title={`TP3 — previous employment, ${year}`}
        sub="A mid-year joiner's pay, EPF, tax and deductions at their previous employer this year, so cumulative monthly tax carries on from where it stood. This employer's own pre-Kuwick months go through Opening balances instead — the server refuses the overlap either way."
        actions={
          mayRun ? (
            <button type="button" className="hr-btn hr-btn--sm" onClick={() => { setError(null); setTp3Open(true); }}>
              <IconPlus />
              Record a TP3
            </button>
          ) : null
        }
      />
      <Table<Tp3Row>
        rowKey="id"
        rows={data?.tp3 ?? []}
        loading={query.isLoading}
        emptyText="No previous employment is declared for this year."
        columns={[
          { title: 'Previous employer', dataIndex: 'previousEmployerName' },
          {
            title: 'Period',
            key: 'period',
            width: 190,
            render: (_: unknown, row: Tp3Row) =>
              row.employmentFrom || row.employmentTo ? (
                <span className="hr-muted">
                  {row.employmentFrom ?? '…'} → {row.employmentTo ?? '…'}
                </span>
              ) : (
                <span className="hr-faint">—</span>
              ),
          },
          { title: 'Gross', key: 'gross', num: true, width: 120, render: (_: unknown, row: Tp3Row) => money(row.grossCents / 100) },
          { title: 'EPF', key: 'epf', num: true, width: 110, render: (_: unknown, row: Tp3Row) => money(row.epfCents / 100) },
          { title: 'MTD paid', key: 'mtd', num: true, width: 110, render: (_: unknown, row: Tp3Row) => money(row.mtdPaidCents / 100) },
          { title: 'Source', key: 'source', render: (_: unknown, row: Tp3Row) => <span className="hr-muted">{row.source}</span> },
          {
            title: '',
            key: 'remove',
            width: 80,
            render: (_: unknown, row: Tp3Row) =>
              mayRun ? (
                <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" style={{ color: 'var(--hr-red)' }} onClick={() => remove('tp3', row.id)}>
                  Delete
                </button>
              ) : null,
          },
        ]}
      />

      <Modal open={tp1Open} title="Record a TP1 for a month" okText="Record it" confirmLoading={saving} onCancel={() => setTp1Open(false)} onOk={saveTp1}>
        {error ? <div className="hr-notice hr-notice--attn">{error}</div> : null}
        <div className="hr-form">
          {field('Month it applies to', <DatePicker picker="month" value={tp1Period} onChange={setTp1Period} style={{ width: '100%' }} />)}
          {field('Approved deductions (RM)', <InputNumber value={tp1Amount} onChange={setTp1Amount} min={0} precision={2} style={{ width: '100%' }} />)}
          {field(
            'Zakat the employee paid themselves (RM)',
            <InputNumber value={tp1Zakat} onChange={setTp1Zakat} min={0} precision={2} style={{ width: '100%' }} />,
            'Zakat deducted through payroll is already counted.',
          )}
          {field(
            'Items, one per line, amount last',
            <Input.TextArea rows={3} value={tp1Items} onChange={(e) => setTp1Items(e.target.value)} placeholder={'Medical treatment for parents 1,500.00\nLifestyle — books 500.00'} />,
            'They must add to the total.',
          )}
          {field('Form received', <DatePicker value={tp1Received} onChange={setTp1Received} style={{ width: '100%' }} />)}
        </div>
      </Modal>

      <Modal open={tp3Open} title={`Record previous employment for ${year}`} okText="Record it" confirmLoading={saving} onCancel={() => setTp3Open(false)} onOk={saveTp3}>
        {error ? <div className="hr-notice hr-notice--attn">{error}</div> : null}
        <div className="hr-form">
          {field('Previous employer', <Input value={tp3Employer} onChange={(e) => setTp3Employer(e.target.value)} />)}
          <div className="hr-form__row">
            {field('Employed from', <DatePicker value={tp3From} onChange={setTp3From} style={{ width: '100%' }} />)}
            {field('to', <DatePicker value={tp3To} onChange={setTp3To} style={{ width: '100%' }} />)}
          </div>
          <div className="hr-form__row">
            {field('Gross paid (RM)', <InputNumber value={tp3Gross} onChange={setTp3Gross} min={0} precision={2} style={{ width: '100%' }} />)}
            {field('EPF (RM)', <InputNumber value={tp3Epf} onChange={setTp3Epf} min={0} precision={2} style={{ width: '100%' }} />)}
            {field('MTD paid (RM)', <InputNumber value={tp3Mtd} onChange={setTp3Mtd} min={0} precision={2} style={{ width: '100%' }} />)}
            {field('Zakat there (RM)', <InputNumber value={tp3Zakat} onChange={setTp3Zakat} min={0} precision={2} style={{ width: '100%' }} />)}
          </div>
          {field('Deductions applied there (RM)', <InputNumber value={tp3Lp} onChange={setTp3Lp} min={0} precision={2} style={{ width: '100%' }} />)}
          {field('Where these figures came from', <Input value={tp3Source} onChange={(e) => setTp3Source(e.target.value)} placeholder="e.g. Borang TP3 dated 3 July 2026" />)}
        </div>
      </Modal>
    </>
  );
}
