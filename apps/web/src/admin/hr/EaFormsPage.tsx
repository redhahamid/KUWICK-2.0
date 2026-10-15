import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Select } from 'antd';
import dayjs from 'dayjs';
import { downloadFile } from '../../core/api-client';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useBorangE, useEaFormVersion, useEaForms, useLegalEmployers, useSetEaFormVersion } from '../hooks/useAdmin';
import { HrPage, Panel, PanelHead, StatusChip, type ChipTone } from './ui';
import { Table } from './ui/Table';
import { IconDownload } from './ui/icons';
import type { EaForm } from '../types';

const rm = (cents: number) => `RM ${(cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<EaForm['status'], { tone: ChipTone; label: string }> = {
  READY: { tone: 'done', label: 'Ready' },
  CHECK: { tone: 'attn', label: 'Check' },
  INCOMPLETE: { tone: 'block', label: 'Missing details' },
};
const query = (params: Record<string, string | number | undefined>) =>
  '?' + Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&');

/**
 * YEAR-END FORMS (overnight brief, 15 October 2026): Borang EA for every
 * employee from approved payroll, the check list of what is missing, and the
 * Borang E totals. Every figure is the server's; this page only shows it.
 */
export function EaFormsPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  // EA forms are given out by the end of February for the year before.
  const [year, setYear] = useState(dayjs().month() < 3 ? dayjs().year() - 1 : dayjs().year());
  const [employerId, setEmployerId] = useState<string | undefined>();
  const params = { year, legalEmployerId: employerId, clinicId };
  const forms = useEaForms(params);
  const borangE = useBorangE(params);
  const employers = useLegalEmployers();
  const [downloading, setDownloading] = useState(false);

  const rows = forms.data?.forms ?? [];
  const missing = rows.filter((row) => row.status !== 'READY');
  const notApproved = forms.data?.notApproved ?? [];

  const download = (path: string, fileName: string) =>
    downloadFile(path, fileName).catch((error) => message.error(error instanceof Error ? error.message : 'Could not download that.'));
  const downloadAll = async () => {
    setDownloading(true);
    await download(`/workforce/ea-forms/all.pdf${query(params)}`, `borang-ea-${year}.pdf`);
    setDownloading(false);
  };

  return (
    <HrPage
      crumb={<Link to="/admin/hr/reports">Reports</Link>}
      title="Year-end forms"
      sub="Borang EA for each employee (give out by end of February) and Borang E for LHDN (by 31 March)."
      error={forms.error instanceof Error ? forms.error.message : null}
      actions={
        <>
          <Select
            size="small"
            aria-label="Tax year"
            value={year}
            onChange={setYear}
            style={{ width: 100 }}
            options={[0, 1, 2].map((back) => ({ value: dayjs().year() - back, label: String(dayjs().year() - back) }))}
          />
          <Select
            size="small"
            aria-label="Employer"
            allowClear
            placeholder="Every employer"
            value={employerId}
            onChange={setEmployerId}
            style={{ minWidth: 200 }}
            options={(employers.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
          />
        </>
      }
    >
      {notApproved.length > 0 ? (
        <div className="hr-notice hr-notice--attn">
          {notApproved.join(', ')} {year} {notApproved.length === 1 ? 'is' : 'are'} not approved yet, so {notApproved.length === 1 ? 'it is' : 'they are'} not on these forms.
        </div>
      ) : null}

      <Panel>
        <PanelHead
          title="Check before you print"
          sub={
            rows.length === 0
              ? `No approved pay in ${year} yet.`
              : missing.length === 0
                ? `All ${rows.length} forms are complete.`
                : `${missing.length} of ${rows.length} forms need a look. Fix the employee record, then come back: the forms update by themselves.`
          }
        />
        {missing.length > 0 ? (
          <ul className="hr-small" data-testid="ea-check-list" style={{ margin: 0, paddingLeft: 18 }}>
            {missing.flatMap((form) =>
              form.problems.map((problem) => (
                <li key={`${form.staffId}-${problem.text}`}>
                  <Link to={`/admin/hr/employees/${form.staffId}`}>{form.employee.name}</Link>: {problem.text}
                </li>
              )),
            )}
          </ul>
        ) : null}
      </Panel>

      <Panel className="hr-mt">
        <PanelHead
          title="Borang EA"
          sub="One page per employee, from approved payroll, on the auditor's C.P.8A template."
          actions={
            rows.length > 0 ? (
              <button type="button" className="hr-btn hr-btn--sm" onClick={downloadAll} disabled={downloading}>
                <IconDownload />
                Download all ({rows.length})
              </button>
            ) : null
          }
        />
        <FormVersion />
        <Table<EaForm>
          rows={rows}
          loading={forms.isLoading}
          rowKey={(row) => `${row.legalEmployerId}-${row.staffId}`}
          emptyText={`No approved pay in ${year}.`}
          columns={[
            { title: 'Employee', dataIndex: ['employee', 'name'] },
            { title: 'Employee No.', dataIndex: ['employee', 'employeeNo'], width: 120, render: (value: string | null) => value ?? '—' },
            { title: 'Tax number', dataIndex: ['employee', 'taxNumber'], width: 150, render: (value: string | null) => value ?? <span className="hr-faint">Missing</span> },
            { title: 'Tax (PCB)', dataIndex: 'pcbCents', num: true, width: 120, render: (value: number) => rm(value) },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 140,
              render: (value: EaForm['status']) => <StatusChip tone={STATUS[value].tone}>{STATUS[value].label}</StatusChip>,
            },
            {
              title: '',
              key: 'pdf',
              width: 80,
              render: (_: unknown, row) => (
                <button
                  type="button"
                  className="hr-btn hr-btn--sm"
                  onClick={() =>
                    download(
                      `/workforce/ea-forms/${row.staffId}/pdf${query({ year, legalEmployerId: row.legalEmployerId })}`,
                      `borang-ea-${year}-${row.employee.name.replace(/\s+/g, '-').toLowerCase()}.pdf`,
                    )
                  }
                >
                  PDF
                </button>
              ),
            },
          ]}
        />
      </Panel>

      <Panel className="hr-mt">
        <PanelHead
          title="Borang E"
          sub={`The employer’s yearly return to LHDN for ${year}, due by ${dayjs(borangE.data?.dueDate ?? `${year + 1}-03-31`).format('D MMMM YYYY')}. File it on e-Filing with the employee list (C.P.8D).`}
          actions={
            (borangE.data?.employers.length ?? 0) > 0 ? (
              <button type="button" className="hr-btn hr-btn--sm" onClick={() => download(`/workforce/borang-e/cp8d.csv${query(params)}`, `cp8d-${year}.csv`)}>
                <IconDownload />
                Employee list (C.P.8D)
              </button>
            ) : null
          }
        />
        {(borangE.data?.employers ?? []).map((row) => (
          <div key={row.legalEmployerId} className="hr-setupRow hr-setupRow--plain" data-testid="borang-e-employer">
            <div>
              <div className="hr-setupRow__title">
                {row.name} · {row.lhdnEmployerNo ?? 'no LHDN employer number yet'}
              </div>
              <div className="hr-setupRow__detail">
                {row.employees} employees, {row.withTax} paying monthly tax. Pay RM {row.remuneration} · PCB RM {row.pcb} · CP38 RM {row.cp38} · Zakat RM{' '}
                {row.zakat} · EPF RM {row.epf} · SOCSO and EIS RM {row.socso}.
              </div>
            </div>
            {row.incomplete > 0 ? <StatusChip tone="block">{row.incomplete} missing details</StatusChip> : <StatusChip tone="done">Ready</StatusChip>}
            <span />
          </div>
        ))}
        <div className="hr-tableFoot">
          <span>Kuwick prepares these from approved payroll. Check them against LHDN’s current forms before you file; Kuwick does not file for you.</span>
        </div>
      </Panel>
    </HrPage>
  );
}

/**
 * THE REVISION PRINTED TOP LEFT, e.g. "(C.P.8A - Pin. 2017)". A setting, so
 * the clinic updates it when LHDN issues a newer form.
 */
function FormVersion() {
  const { message } = App.useApp();
  const version = useEaFormVersion();
  const save = useSetEaFormVersion();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? version.data?.versionLabel ?? '';
  return (
    <div className="hr-toolbar" style={{ gap: 8, marginBottom: 8 }}>
      <label htmlFor="ea-version" className="hr-small">
        Form version printed on each page
      </label>
      <input id="ea-version" className="hr-f" style={{ maxWidth: 240 }} value={value} onChange={(event) => setDraft(event.target.value)} />
      {draft !== null && draft !== version.data?.versionLabel ? (
        <button
          type="button"
          className="hr-btn hr-btn--sm hr-btn--primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { versionLabel: draft },
              {
                onSuccess: () => {
                  message.success('Form version saved. New EA forms print it.');
                  setDraft(null);
                },
                onError: (error: Error) => message.error(error.message),
              },
            )
          }
        >
          Save
        </button>
      ) : null}
    </div>
  );
}
