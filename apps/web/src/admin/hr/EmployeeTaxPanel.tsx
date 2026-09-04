import { useState } from 'react';
import { App, Button, DatePicker, Input, InputNumber, Modal, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
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
  const year = new Date().getFullYear();
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
    const cents = Math.round((tp1Amount ?? 0) * 100);
    const zakatCents = Math.round((tp1Zakat ?? 0) * 100);
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
    setSaving(true);
    apiClient
      .post(`/workforce/employees/${staffId}/tp3`, {
        taxYear: year,
        previousEmployerName: tp3Employer.trim(),
        employmentFrom: tp3From?.format('YYYY-MM-DD'),
        employmentTo: tp3To?.format('YYYY-MM-DD'),
        grossCents: Math.round((tp3Gross ?? 0) * 100),
        epfCents: Math.round((tp3Epf ?? 0) * 100),
        mtdPaidCents: Math.round((tp3Mtd ?? 0) * 100),
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

  return (
    <>
      <AdminSection
        title={`TP1 — monthly deduction claims, ${year}`}
        description="The employer's approved figure off the employee's Form TP1. It enters that month's tax as LP1; the relief catalogue's annual caps are not verified against LHDN, so approving the form remains the employer's own act."
        actions={
          mayRun ? (
            <Button size="small" type="primary" ghost onClick={() => { setError(null); setTp1Open(true); }}>
              Record a TP1
            </Button>
          ) : undefined
        }
      >
        <DataTable<Tp1Row>
          rowKey="id"
          rows={data?.tp1 ?? []}
          emptyText="No TP1 has been recorded this year. Monthly tax is worked out as though none was filed — which is correct for an employee who filed none."
          columns={[
            { title: 'Month', dataIndex: 'period', width: 110, render: (value: string) => dayjs(`${value}-01`).format('MMM YYYY') },
            {
              title: 'Deductions (LP1)',
              width: 150,
              align: 'right' as const,
              render: (_: unknown, row: Tp1Row) => money(row.deductionsCents / 100),
            },
            {
              title: 'Self-paid zakat',
              width: 140,
              align: 'right' as const,
              render: (_: unknown, row: Tp1Row) =>
                row.zakatSelfPaidCents > 0 ? money(row.zakatSelfPaidCents / 100) : <span className="kw-muted">—</span>,
            },
            {
              title: 'Items',
              render: (_: unknown, row: Tp1Row) =>
                row.items ? (
                  <span className="kw-muted">{row.items.map((item) => item.label).join(' · ')}</span>
                ) : (
                  <span className="kw-muted">Total only</span>
                ),
            },
            {
              title: 'Recorded',
              width: 170,
              render: (_: unknown, row: Tp1Row) => (
                <Tooltip title={row.receivedDate ? `Form received ${row.receivedDate}` : undefined}>
                  <span className="kw-muted">
                    {row.recordedBy}, {dayjs(row.recordedAt).format('D MMM')}
                  </span>
                </Tooltip>
              ),
            },
            {
              title: '',
              width: 80,
              render: (_: unknown, row: Tp1Row) =>
                mayRun ? (
                  <Button size="small" danger type="text" onClick={() => remove('tp1', row.id)}>
                    Delete
                  </Button>
                ) : null,
            },
          ]}
        />
      </AdminSection>

      <AdminSection
        title={`TP3 — previous employment, ${year}`}
        description="A mid-year joiner's pay, EPF, tax and deductions at their previous employer this year, so cumulative monthly tax carries on from where it stood. This employer's own pre-Kuwick months go through the opening-balance import instead — the server refuses the overlap either way."
        actions={
          mayRun ? (
            <Button size="small" type="primary" ghost onClick={() => { setError(null); setTp3Open(true); }}>
              Record a TP3
            </Button>
          ) : undefined
        }
      >
        <DataTable<Tp3Row>
          rowKey="id"
          rows={data?.tp3 ?? []}
          emptyText="No previous employment is declared for this year."
          columns={[
            { title: 'Previous employer', dataIndex: 'previousEmployerName' },
            {
              title: 'Period',
              width: 190,
              render: (_: unknown, row: Tp3Row) =>
                row.employmentFrom || row.employmentTo ? (
                  <span className="kw-muted">
                    {row.employmentFrom ?? '…'} → {row.employmentTo ?? '…'}
                  </span>
                ) : (
                  <span className="kw-muted">—</span>
                ),
            },
            { title: 'Gross', width: 120, align: 'right' as const, render: (_: unknown, row: Tp3Row) => money(row.grossCents / 100) },
            { title: 'EPF', width: 110, align: 'right' as const, render: (_: unknown, row: Tp3Row) => money(row.epfCents / 100) },
            { title: 'MTD paid', width: 110, align: 'right' as const, render: (_: unknown, row: Tp3Row) => money(row.mtdPaidCents / 100) },
            {
              title: 'Source',
              render: (_: unknown, row: Tp3Row) => <span className="kw-muted">{row.source}</span>,
            },
            {
              title: '',
              width: 80,
              render: (_: unknown, row: Tp3Row) =>
                mayRun ? (
                  <Button size="small" danger type="text" onClick={() => remove('tp3', row.id)}>
                    Delete
                  </Button>
                ) : null,
            },
          ]}
        />
      </AdminSection>

      <Modal
        open={tp1Open}
        title="Record a TP1 for a month"
        okText="Record it"
        confirmLoading={saving}
        onCancel={() => setTp1Open(false)}
        onOk={saveTp1}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Month it applies to</div>
            <DatePicker picker="month" value={tp1Period} onChange={setTp1Period} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Approved deductions (RM)</div>
            <InputNumber value={tp1Amount} onChange={setTp1Amount} min={0} precision={2} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
              Zakat the employee paid themselves (RM) — zakat deducted through payroll is already counted
            </div>
            <InputNumber value={tp1Zakat} onChange={setTp1Zakat} min={0} precision={2} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
              Items, one per line, amount last — they must add to the total
            </div>
            <Input.TextArea
              rows={3}
              value={tp1Items}
              onChange={(e) => setTp1Items(e.target.value)}
              placeholder={'Medical treatment for parents 1,500.00\nLifestyle — books 500.00'}
            />
          </div>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Form received</div>
            <DatePicker value={tp1Received} onChange={setTp1Received} style={{ width: '100%' }} />
          </div>
        </div>
      </Modal>

      <Modal
        open={tp3Open}
        title={`Record previous employment for ${year}`}
        okText="Record it"
        confirmLoading={saving}
        onCancel={() => setTp3Open(false)}
        onOk={saveTp3}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Previous employer</div>
            <Input value={tp3Employer} onChange={(e) => setTp3Employer(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Employed from</div>
              <DatePicker value={tp3From} onChange={setTp3From} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>to</div>
              <DatePicker value={tp3To} onChange={setTp3To} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Gross paid (RM)</div>
              <InputNumber value={tp3Gross} onChange={setTp3Gross} min={0} precision={2} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>EPF (RM)</div>
              <InputNumber value={tp3Epf} onChange={setTp3Epf} min={0} precision={2} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>MTD paid (RM)</div>
              <InputNumber value={tp3Mtd} onChange={setTp3Mtd} min={0} precision={2} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Zakat there (RM)</div>
              <InputNumber value={tp3Zakat} onChange={setTp3Zakat} min={0} precision={2} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Deductions applied there (RM)</div>
              <InputNumber value={tp3Lp} onChange={setTp3Lp} min={0} precision={2} style={{ width: '100%' }} />
            </div>
          </div>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
              Where these figures came from — e.g. “Borang TP3 dated 3 July 2026”
            </div>
            <Input value={tp3Source} onChange={(e) => setTp3Source(e.target.value)} />
          </div>
        </div>
      </Modal>
    </>
  );
}
