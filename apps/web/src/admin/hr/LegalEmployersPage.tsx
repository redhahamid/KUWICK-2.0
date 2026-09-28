import { useState } from 'react';
import { App, DatePicker, Input, Select } from 'antd';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { useLegalEmployers, useRecordEmployerHrd, useUpsertLegalEmployer } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { Drawer, HrPage, Panel, ProblemNotice, StatusChip, useProblemFocus } from './ui';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useClinics } from '../../core/hooks/useClinics';
import { Table } from './ui/Table';
import type { LegalEmployerRow } from '../types';

/** The Act's own words for each class, and the rate the Act fixes for it. */
const HRD_LABELS: Record<string, string> = {
  MANDATORY_SECTION_14: 'Registered — s.14 mandatory (1%)',
  OPTIONAL_SECTION_15: 'Registered — s.15 optional (0.5%)',
  NOT_REGISTERED: 'Not registered',
};

const FIELDS: [string, string][] = [
  ['name', 'Registered name'],
  ['registrationNo', 'Company registration number'],
  ['epfEmployerNo', 'EPF employer number'],
  ['socsoEmployerNo', 'SOCSO employer code'],
  ['lhdnEmployerNo', 'LHDN employer number (E)'],
  ['addressLine1', 'Address'],
  ['city', 'City'],
  ['state', 'State'],
  ['bankName', 'Bank'],
  ['bankAccountNo', 'Bank account number'],
  ['bankAccountName', 'Account name'],
];

/**
 * THE EMPLOYER THAT FILES AND PAYS.
 *
 * Payroll runs were scoped to a BRANCH. A branch employs nobody and files
 * nothing — EPF, SOCSO, EIS and PCB submissions are all made by an employer,
 * against an employer number, and there was nowhere to put one.
 *
 * The audited competitor has the opposite limitation: one company per account,
 * with location reduced to a name and an address, so a group running two Sdn
 * Bhds cannot use it at all.
 */
export function LegalEmployersPage() {
  const { message } = App.useApp();
  // The companies are tenant-wide; the employee count beside each follows
  // the shell's branch picker, and the column says which branch it counts.
  const { clinicId } = useClinicFilter();
  const { data: clinics } = useClinics();
  const branchName = clinicId ? (clinics ?? []).find((clinic) => clinic.id === clinicId)?.name : undefined;
  const employers = useLegalEmployers(clinicId);
  const upsert = useUpsertLegalEmployer();
  const recordHrd = useRecordEmployerHrd();
  const mayManage = useCan('hr.statutory.manage');
  // The HRD class is recorded under the same permission as an employee's
  // standing — it is a dated employment-record fact, not configuration.
  const mayRecordHrd = useCan('hr.employee.manage');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LegalEmployerRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Same shape as the rule set drawer: scrolling body, pinned footer.
  useProblemFocus(error);

  const [hrdFor, setHrdFor] = useState<LegalEmployerRow | null>(null);
  const [hrdClass, setHrdClass] = useState<string | undefined>();
  const [hrdFrom, setHrdFrom] = useState(dayjs().startOf('month'));
  const [hrdReason, setHrdReason] = useState('');
  const [hrdError, setHrdError] = useState<string | null>(null);

  function edit(row: LegalEmployerRow | null) {
    setEditing(row);
    setForm(
      row
        ? {
            name: row.name,
            registrationNo: row.registrationNo ?? '',
            epfEmployerNo: row.epfEmployerNo ?? '',
            socsoEmployerNo: row.socsoEmployerNo ?? '',
            lhdnEmployerNo: row.lhdnEmployerNo ?? '',
            addressLine1: row.addressLine1 ?? '',
            city: row.city ?? '',
            state: row.state ?? '',
            bankName: row.bankName ?? '',
            // WRITE-ONLY: the server never sends the number back, so there is
            // nothing to prefill. Blank means "leave the one on file alone".
            bankAccountNo: '',
            bankAccountName: row.bankAccountName ?? '',
          }
        : { name: '' },
    );
    setError(null);
    setOpen(true);
  }

  async function saveEmployer() {
    setError(null);
    if (!form.name?.trim()) {
      setError('An employer needs a registered name.');
      return;
    }
    try {
      // A blank bank-account box means "leave the one on file alone" — the
      // field is write-only, so blank is its resting state, and sending ''
      // would clear a number the operator never saw.
      const { bankAccountNo, ...rest } = form;
      await upsert.mutateAsync({
        ...(editing ? { id: editing.id } : {}),
        ...rest,
        ...(bankAccountNo && bankAccountNo.trim() !== '' ? { bankAccountNo: bankAccountNo.trim() } : {}),
      });
      message.success('Saved.');
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The server refused the change and did not say why.');
    }
  }

  async function saveHrd() {
    setHrdError(null);
    if (!hrdClass) {
      setHrdError('Choose the registration class. The Act fixes the rate — 1% under s.14, 0.5% under s.15.');
      return;
    }
    if (!hrdReason.trim()) {
      setHrdError('Say why this is being recorded — registration confirmed, headcount crossed, exemption…');
      return;
    }
    try {
      await recordHrd.mutateAsync({
        legalEmployerId: hrdFor!.id,
        effectiveFrom: hrdFrom.format('YYYY-MM-DD'),
        hrdRegistration: hrdClass,
        reason: hrdReason.trim(),
      });
      message.success('Recorded. The levy computes from the date it takes effect.');
      setHrdFor(null);
    } catch (e) {
      setHrdError(e instanceof Error ? e.message : 'The server refused the change and did not say why.');
    }
  }

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Company &amp; statutory
        </>
      }
      title="Company & statutory"
      sub="The entity that employs, files and pays. A branch is where work happens; it files nothing."
      error={employers.error instanceof Error ? employers.error.message : null}
      actions={
        mayManage ? (
          <button type="button" className="hr-btn hr-btn--primary" onClick={() => edit(null)}>
            + New employer
          </button>
        ) : null
      }
    >

      <Panel>
        <Table<LegalEmployerRow>
          rowKey="id"
          loading={employers.isLoading}
          rows={employers.data ?? []}
          emptyText="No legal employer is recorded."
          emptyHint="Nothing can be filed or paid without one."
          columns={[
            {
              title: 'Employer',
              dataIndex: 'name',
              render: (value: string, row) => (
                <div>
                  <div className="hr-strong">{value}</div>
                  <span className="hr-faint hr-small">{row.registrationNo ?? 'No registration number'}</span>
                </div>
              ),
            },
            { title: 'EPF', dataIndex: 'epfEmployerNo', render: (v: string | null) => v ?? <span className="hr-faint">—</span> },
            { title: 'SOCSO', dataIndex: 'socsoEmployerNo', render: (v: string | null) => v ?? <span className="hr-faint">—</span> },
            { title: 'LHDN (E)', dataIndex: 'lhdnEmployerNo', render: (v: string | null) => v ?? <span className="hr-faint">—</span> },
            {
              /*
               * THE LEVY CLASS IS A FACT WITH A DATE, and until it is recorded
               * the levy on every payslip is a warning, not a figure. This
               * column and its action are the remediation path the run's
               * HRD_REGISTRATION_UNRECORDED warning deep-links to — a warning
               * whose fix has no screen is a dead end.
               */
              title: 'HRD Corp',
              key: 'hrd',
              width: 210,
              render: (_: unknown, row: LegalEmployerRow) =>
                row.hrdRegistration ? (
                  HRD_LABELS[row.hrdRegistration] ?? row.hrdRegistration
                ) : (
                  <StatusChip tone="attn">Not recorded</StatusChip>
                ),
            },
            { title: clinicId ? `Employees at ${branchName ?? 'this branch'}` : 'Employees', dataIndex: 'employeeCount', num: true, width: clinicId ? 200 : 100 },
            {
              title: 'Could it file?',
              key: 'readiness',
              width: 160,
              render: (_: unknown, row) =>
                row.statutoryReadiness.complete ? (
                  <StatusChip tone="done">Complete</StatusChip>
                ) : (
                  <span>
                    <StatusChip tone="attn">{row.statutoryReadiness.missing.length} missing</StatusChip>
                    <div className="hr-faint hr-small">{row.statutoryReadiness.missing.join(', ')}</div>
                  </span>
                ),
            },
            ...(mayManage || mayRecordHrd
              ? [
                  {
                    title: '',
                    key: 'actions',
                    width: 170,
                    render: (_: unknown, row: LegalEmployerRow) => (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        {mayManage ? (
                          <button type="button" className="hr-btn hr-btn--sm" onClick={() => edit(row)}>
                            Edit
                          </button>
                        ) : null}
                        {mayRecordHrd ? (
                          <button
                            type="button"
                            className="hr-btn hr-btn--sm"
                            onClick={() => {
                              setHrdFor(row);
                              setHrdClass(row.hrdRegistration ?? undefined);
                              setHrdFrom(dayjs().startOf('month'));
                              setHrdReason('');
                              setHrdError(null);
                            }}
                          >
                            HRD class
                          </button>
                        ) : null}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      {/*
        * THE PAY COMPONENTS ARE NOT LISTED TWICE, and the statutory tables are
        * not either. Each has a page of its own; this one is about the entity.
        */}
      <p className="hr-note">
        What the clinic can pay or deduct is on <Link className="hr-link" to="/admin/hr/settings/payroll-items">Payroll items</Link>; the
        rates it deducts at are on <Link className="hr-link" to="/admin/hr/settings/statutory">Statutory rates</Link>. The numbers
        above decide whether this employer can file at all.
      </p>

      <Drawer
        open={open}
        title={editing ? `Edit ${editing.name}` : 'New legal employer'}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={saveEmployer} disabled={upsert.isPending}>
              Save
            </button>
          </>
        }
      >
        <ProblemNotice problem={error} />
        <div style={{ display: 'grid', gap: 10 }}>
          {FIELDS.map(([key, label]) => (
            <label key={key}>
              <div className="hr-small hr-muted" style={{ marginBottom: 4 }}>{label}</div>
              <Input
                value={form[key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={
                  key === 'bankAccountNo' && editing?.bankAccountOnFile
                    ? `On file, ends ${editing.bankAccountLastFour} — type only to replace`
                    : undefined
                }
              />
            </label>
          ))}
        </div>
      </Drawer>

      <Drawer
        open={hrdFor !== null}
        title={hrdFor ? `HRD Corp registration — ${hrdFor.name}` : ''}
        onClose={() => setHrdFor(null)}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setHrdFor(null)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={saveHrd} disabled={recordHrd.isPending}>
              Record
            </button>
          </>
        }
      >
        {hrdError ? <div className="hr-notice hr-notice--block" style={{ margin: '0 0 12px' }}>{hrdError}</div> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div className="hr-small hr-muted" style={{ marginBottom: 4 }}>In force from</div>
            <DatePicker value={hrdFrom} onChange={(v) => v && setHrdFrom(v)} style={{ width: '100%' }} allowClear={false} format="D MMM YYYY" />
          </label>
          <label>
            <div className="hr-small hr-muted" style={{ marginBottom: 4 }}>Registration class</div>
            <Select
              value={hrdClass}
              onChange={setHrdClass}
              style={{ width: '100%' }}
              placeholder="Not recorded"
              options={Object.entries(HRD_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </label>
          <label>
            <div className="hr-small hr-muted" style={{ marginBottom: 4 }}>Reason</div>
            <Input.TextArea rows={2} value={hrdReason} onChange={(e) => setHrdReason(e.target.value)} placeholder="HRD Corp registration letter dated…" />
          </label>
          <p className="hr-faint hr-small" style={{ margin: 0 }}>
            The rate is never typed here: 1% (section 14) and 0.5% (section 15) are the PSMB Act&apos;s own numbers. A change is a new dated
            version — an earlier month&apos;s levy keeps the class that was true then.
          </p>
        </div>
      </Drawer>
    </HrPage>
  );
}
