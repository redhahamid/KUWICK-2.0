import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dropdown } from 'antd';
import dayjs from 'dayjs';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useClinics } from '../../core/hooks/useClinics';
import { useCan } from '../../core/hooks/useCan';
import { useEmployees, usePayrollReadiness, usePayrollRuns } from '../hooks/useAdmin';
import { initialsOf } from './ui/who';
import { HrPage, Panel, SegControl, StatCard, StatRow, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconCalendar, IconDownload, IconEdit, IconEmployees, IconInfo, IconMore, IconPayroll, IconPlus } from './ui/icons';
import { downloadCsv } from './ui/csv';
import { CompleteProfileDrawer } from './CompleteProfileDrawer';
import { MarkResignedModal } from './MarkResignedModal';
import { EpfBasisForBranchDrawer } from './EpfBasisForBranchDrawer';
import { leftLabel } from './leftLabel';
import { DeleteEmployeeModal } from './DeleteEmployeeModal';
import { BenefitsView } from './BenefitsView';
import { JobTitlesDrawer } from './JobTitlesDrawer';
import type { EmployeeRow, PayrollReadinessItem } from '../types';

/**
 * EMPLOYEES — the directory, on the kit.
 *
 * Four things a row says, in the mockup's order: who; what kind of
 * employment; whether EPF, SOCSO and EIS apply to them and whether a bank
 * account is on file — four dots, green or red; when they joined; and whether
 * the record is complete enough to pay. Then Edit, and a menu of the three
 * things you can do: View · Edit · Mark as resigned · Delete. Delete is
 * only for a record that should never have existed — the server refuses
 * anybody an approved run paid and anybody who worked here. A
 * person who was paid is a person the year's forms still name.
 *
 * THE DOTS ARE TWO DIFFERENT FACTS. EPF, SOCSO and EIS read the statutory
 * standing in force today — does the scheme apply to this person — and a
 * red dot there is not a defect: a foreign worker outside SOCSO is correctly
 * red and correctly "Complete". The bank dot reads whether an account is on
 * file, and a red one IS a defect, because nobody can be paid without it.
 * "Record" is the payroll gate's own checklist for this month, so a person
 * this page calls Complete is a person the run can pay.
 *
 * THE CLINICAL CREDENTIAL STAYS ON THE ROW. "Clinical access" beside a
 * position is a fact about the job, not about employment, and the browser
 * guarantee from the employee-master work holds it here: an account, an
 * employment and a clinical credential are three separate facts.
 */
type Seg = 'ACTIVE' | 'RESIGNED' | 'ALL' | 'NO_RECORD';
type View = 'employees' | 'benefits';

const GONE = new Set(['RESIGNED', 'TERMINATED']);
const TYPE_LABEL: Record<string, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  PART_TIME: 'Part-time',
  LOCUM: 'Locum',
  INTERN: 'Intern',
};
/** The payroll gate's item labels, said as what is missing. */
const SHORT: Record<string, string> = {
  'Bank account': 'Bank missing',
  Salary: 'Salary missing',
  'Legal employer': 'Employer missing',
  'Rest day': 'Rest day missing',
  'Monthly tax (PCB) information': 'Tax info missing',
  'EPF, SOCSO and EIS': 'Standing missing',
  'Date of birth': 'Date of birth missing',
  'Pay history for the year': 'Pay history missing',
};
const shortOf = (label: string) => SHORT[label] ?? `${label} missing`;

type RecordState = { label: string; tone: 'done' | 'attn' | 'muted'; blockers: string[]; noBank?: boolean };

function recordOf(row: EmployeeRow, items: PayrollReadinessItem[] | undefined): RecordState {
  if (!row.hasProfile) return { label: 'No record', tone: 'muted', blockers: [] };
  if (!items) {
    // Not on this month's gate (a contractor, or somebody it has not seen
    // yet): the one thing every record needs is the bank account.
    return row.bankAccountOnFile
      ? { label: 'Complete', tone: 'done', blockers: [] }
      : { label: 'Bank missing', tone: 'attn', blockers: ['Bank account'] };
  }
  const blockers = items.filter((item) => !item.done && item.severity === 'BLOCKING').map((item) => item.label);
  /*
   * COMPLETE IS NOT THE SAME AS PAYABLE BY TRANSFER (UAT, 6 October 2026). A
   * missing bank account does not stop the month — it is advisory, and the
   * bank listing leaves the person out with the reason — but a plain
   * "Complete" beside a record nobody can transfer to read as all done.
   */
  const noBank = items.some((item) => item.key === 'bank' && !item.done);
  if (blockers.length === 0) {
    return noBank ? { label: 'Complete — no bank account', tone: 'attn', blockers, noBank } : { label: 'Complete', tone: 'done', blockers };
  }
  return { label: blockers.length === 1 ? shortOf(blockers[0]) : `${blockers.length} missing`, tone: 'attn', blockers };
}

const Dot = ({ on, title }: { on: boolean | null; title: string }) => (
  <span
    className={`hr-dot ${on === null ? 'hr-dot--muted' : on ? 'hr-dot--ok' : 'hr-dot--block'}`}
    role="img"
    aria-label={`${title}: ${on === null ? 'no standing recorded' : on ? 'yes' : 'no'}`}
    title={on === null ? `${title}: no statutory standing recorded` : `${title}: ${on ? 'yes' : 'no'}`}
  />
);

export function EmployeesPage() {
  const { clinicId } = useClinicFilter();
  const { data: clinics } = useClinics();
  const branchName = clinicId ? (clinics ?? []).find((clinic) => clinic.id === clinicId)?.name : undefined;
  const navigate = useNavigate();
  const mayManage = useCan('hr.employee.manage');
  // Setting a contribution basis needs payroll access, as on the person's own page.
  const mayPayroll = useCan('hr.payroll.view');
  const [search, setSearch] = useSearchParams();
  const view: View = search.get('view') === 'benefits' ? 'benefits' : 'employees';

  const employees = useEmployees({ clinicId });
  const readiness = usePayrollReadiness({ period: dayjs().format('YYYY-MM'), clinicId });
  const runs = usePayrollRuns({ clinicId, year: dayjs().year() });

  const [seg, setSeg] = useState<Seg>('ACTIVE');
  const [completing, setCompleting] = useState<{ staffId: string; fullName: string } | null>(null);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [epfBranchOpen, setEpfBranchOpen] = useState(false);
  const [resigning, setResigning] = useState<{ staffId: string; fullName: string } | null>(null);
  const [deleting, setDeleting] = useState<{ staffId: string; fullName: string } | null>(null);

  // ?staffId= still redirects to that person, so links written before the
  // employee record was a route still land on them.
  const legacyStaffId = search.get('staffId');
  useEffect(() => {
    if (legacyStaffId) navigate(`/admin/hr/employees/${legacyStaffId}`, { replace: true });
  }, [legacyStaffId, navigate]);

  const itemsByStaff = useMemo(() => {
    const map = new Map<string, PayrollReadinessItem[]>();
    for (const row of readiness.data?.employees ?? []) map.set(row.staffId, row.readiness.items);
    return map;
  }, [readiness.data]);

  const all = employees.data ?? [];
  const records = useMemo(() => new Map(all.map((row) => [row.staffId, recordOf(row, itemsByStaff.get(row.staffId))])), [all, itemsByStaff]);
  /*
   * EMPLOYEES ARE PEOPLE WITH AN EMPLOYMENT RECORD (UAT, 11 October 2026). A
   * login with no HR record (a doctor's or a clerk's account kept for their
   * clinical work) is listed only under "Accounts without HR record", and is
   * not counted in the figures above the list.
   */
  const employed = all.filter((row) => row.hasProfile && !GONE.has(row.employmentStatus ?? ''));
  const withoutRecord = all.filter((row) => !row.hasProfile).length;

  const rows = useMemo(
    () =>
      all.filter((row) => {
        if (seg === 'NO_RECORD') return !row.hasProfile;
        if (!row.hasProfile) return false;
        const gone = GONE.has(row.employmentStatus ?? '');
        if (seg === 'ACTIVE') return !gone;
        if (seg === 'RESIGNED') return gone;
        return true;
      }),
    [all, seg],
  );

  // ── The four figures ──────────────────────────────────────────────────────
  const byType = employed.reduce<Record<string, number>>((acc, row) => {
    const key = row.employmentType ?? 'NO_RECORD';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const typeLine = ['PERMANENT', 'CONTRACT', 'PART_TIME', 'LOCUM', 'INTERN']
    .filter((key) => byType[key])
    .map((key) => `${byType[key]} ${TYPE_LABEL[key].toLowerCase()}`)
    .join(' · ');

  const joinedThisYear = employed.filter((row) => row.startDate && dayjs(row.startDate).year() === dayjs().year());
  const joinedNames = joinedThisYear.slice(0, 3).map((row) => row.fullName).join(', ') + (joinedThisYear.length > 3 ? ` +${joinedThisYear.length - 3}` : '');

  // A record complete but for its bank account is complete: it is counted
  // apart, so the card never says "incomplete" beside a chip saying "Complete".
  const incomplete = employed.filter((row) => records.get(row.staffId)?.tone !== 'done' && !records.get(row.staffId)?.noBank);
  const withoutBank = employed.filter((row) => records.get(row.staffId)?.noBank).length;
  const reasons = incomplete.flatMap((row) => {
    const state = records.get(row.staffId);
    return state?.label === 'No record' ? ['No employment record'] : (state?.blockers ?? []).map(shortOf);
  });
  const commonest = [...reasons.reduce((m, r) => m.set(r, (m.get(r) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0];

  const latestRun = [...(runs.data ?? [])].sort((a, b) => b.period.localeCompare(a.period))[0];
  const runSettled = latestRun && (latestRun.status === 'APPROVED' || latestRun.status === 'PAID');

  const exportRows = () =>
    downloadCsv(
      'employees',
      ['Name', 'Position', 'Type', 'Branch', 'Employee no.', 'Joined', 'EPF applies', 'SOCSO applies', 'EIS applies', 'Bank on file', 'Record', 'Status'],
      rows.map((row) => [
        row.fullName,
        row.position,
        row.employmentType ? TYPE_LABEL[row.employmentType] ?? row.employmentType : '',
        row.clinicName,
        row.employeeNo,
        row.startDate ? dayjs(row.startDate).format('YYYY-MM-DD') : '',
        row.schemes ? (row.schemes.epf ? 'yes' : 'no') : '',
        row.schemes ? (row.schemes.socso ? 'yes' : 'no') : '',
        row.schemes ? (row.schemes.eis ? 'yes' : 'no') : '',
        row.bankAccountOnFile ? 'yes' : 'no',
        records.get(row.staffId)?.label ?? '',
        row.employmentStatus ?? '',
      ]),
    );

  const setView = (next: View) => {
    const params = new URLSearchParams(search);
    if (next === 'benefits') params.set('view', 'benefits');
    else params.delete('view');
    setSearch(params, { replace: true });
  };

  const tabs = (
    <div className="hr-tabs" role="tablist" aria-label="Employees views">
      <button type="button" role="tab" aria-selected={view === 'employees'} className={view === 'employees' ? 'is-active' : ''} onClick={() => setView('employees')}>
        Employees
      </button>
      <button type="button" role="tab" aria-selected={view === 'benefits'} className={view === 'benefits' ? 'is-active' : ''} onClick={() => setView('benefits')}>
        Medical benefits
      </button>
    </div>
  );

  const open = (row: EmployeeRow) =>
    row.hasProfile ? navigate(`/admin/hr/employees/${row.staffId}`) : setCompleting({ staffId: row.staffId, fullName: row.fullName });

  return (
    <HrPage
      title="Employees"
      sub="Click a name to open the record. Salary and allowance changes are dated, so past payrolls never move."
      error={employees.error instanceof Error ? employees.error.message : null}
      actions={
        <>
          {view === 'employees' ? (
            <button type="button" className="hr-btn" onClick={exportRows} disabled={rows.length === 0}>
              <IconDownload />
              Export
            </button>
          ) : null}
          {mayManage && view === 'employees' ? (
            <button type="button" className="hr-btn" onClick={() => setTitlesOpen(true)}>
              Job titles
            </button>
          ) : null}
          {mayManage && view === 'employees' ? (
            <button type="button" className="hr-btn" onClick={() => navigate('/admin/hr/employees/bulk')}>
              Add several
            </button>
          ) : null}
          {mayManage && mayPayroll && view === 'employees' ? (
            <button
              type="button"
              className="hr-btn"
              disabled={!clinicId}
              title={clinicId ? undefined : 'Pick a branch first: this sets everybody in one branch.'}
              onClick={() => setEpfBranchOpen(true)}
            >
              Set EPF basis for branch
            </button>
          ) : null}
          {mayManage ? (
            <button type="button" className="hr-btn hr-btn--primary" onClick={() => navigate('/admin/hr/employees/new')}>
              <IconPlus />
              Add employee
            </button>
          ) : null}
        </>
      }
    >
      {titlesOpen ? <JobTitlesDrawer open onClose={() => setTitlesOpen(false)} /> : null}
      {clinicId && epfBranchOpen ? (
        <EpfBasisForBranchDrawer
          open
          clinicId={clinicId}
          branchName={branchName ?? 'This branch'}
          onClose={() => setEpfBranchOpen(false)}
        />
      ) : null}
      <CompleteProfileDrawer staffId={completing?.staffId ?? null} fullName={completing?.fullName ?? ''} onClose={() => setCompleting(null)} />
      <MarkResignedModal staffId={resigning?.staffId ?? null} fullName={resigning?.fullName ?? ''} open={Boolean(resigning)} onClose={() => setResigning(null)} />
      <DeleteEmployeeModal staffId={deleting?.staffId ?? null} fullName={deleting?.fullName ?? ''} open={Boolean(deleting)} onClose={() => setDeleting(null)} />

      {view === 'benefits' ? (
        <BenefitsView clinicId={clinicId} tabs={tabs} />
      ) : (
        <>
          <StatRow>
            <StatCard icon={<IconEmployees />} label="Active" value={employed.length} sub={typeLine || 'Nobody on record yet'} />
            <StatCard icon={<IconCalendar />} label="Joined this year" value={joinedThisYear.length} sub={joinedThisYear.length ? joinedNames : 'Nobody yet'} />
            <StatCard
              icon={<IconInfo />}
              label="Records incomplete"
              value={incomplete.length}
              tone={incomplete.length > 0 ? 'gold' : 'plain'}
              sub={
                incomplete.length > 0
                  ? commonest
                  : withoutBank > 0
                    ? `Every record is complete · ${withoutBank} without a bank account`
                    : 'Every record is complete'
              }
            />
            <StatCard
              icon={<IconPayroll />}
              label="Monthly payroll"
              value={latestRun ? `RM${Math.round(latestRun.grossTotal).toLocaleString('en-MY')}` : '—'}
              sub={latestRun ? `Gross${runSettled ? '' : ', not yet approved'}, ${dayjs(latestRun.period).format('MMMM YYYY')}` : 'No payroll run yet'}
            />
          </StatRow>

          <Panel>
            {tabs}
            <Table<EmployeeRow>
              rowKey="staffId"
              rows={rows}
              loading={employees.isLoading}
              searchFields={['fullName', 'position', 'employeeNo', 'department']}
              searchPlaceholder="Search name or role"
              searchLabel="Search name or role"
              emptyText={seg === 'RESIGNED' ? 'Nobody has left.' : seg === 'NO_RECORD' ? 'Every account has an HR record.' : 'No staff records.'}
              onRow={(row) => ({ onClick: () => open(row) })}
              toolbar={
                <SegControl<Seg>
                  label="Show"
                  value={seg}
                  onChange={setSeg}
                  options={[
                    { value: 'ACTIVE', label: 'Active' },
                    { value: 'RESIGNED', label: 'Resigned' },
                    { value: 'ALL', label: 'All' },
                    { value: 'NO_RECORD', label: withoutRecord ? `Accounts without HR record (${withoutRecord})` : 'Accounts without HR record' },
                  ]}
                />
              }
              toolbarRight={<span className="hr-small hr-faint">⋯ = View · Edit · Mark as resigned · Delete. Delete is only for a record that should never have existed; anyone who worked is marked as resigned.</span>}
              columns={[
                {
                  title: 'Employee',
                  dataIndex: 'fullName',
                  render: (value: string, row) => (
                    <div className="hr-who">
                      <span className="hr-who__avatar">{initialsOf(value)}</span>
                      <div>
                        <div className="hr-who__name">{value}</div>
                        <div className="hr-who__role">
                          {row.position ?? (row.hasProfile ? 'No position recorded' : 'No employment record')}
                          {row.clinicalAccess ?? row.canSignClinicalNotes ? ' · Clinical access' : ' · No clinical access'}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: 'Type',
                  dataIndex: 'employmentType',
                  width: 180,
                  render: (value: string | null, row) =>
                    row.hasProfile ? (
                      <StatusChip tone={GONE.has(row.employmentStatus ?? '') ? 'block' : 'muted'}>
                        {GONE.has(row.employmentStatus ?? '') ? leftLabel(row.endDate) : (TYPE_LABEL[value ?? ''] ?? value ?? '—')}
                      </StatusChip>
                    ) : (
                      <StatusChip tone="attn">No record</StatusChip>
                    ),
                },
                { title: 'EPF', key: 'epf', width: 64, align: 'center' as const, render: (_: unknown, row) => <Dot on={row.schemes?.epf ?? null} title="EPF applies" /> },
                { title: 'SOCSO', key: 'socso', width: 74, align: 'center' as const, render: (_: unknown, row) => <Dot on={row.schemes?.socso ?? null} title="SOCSO applies" /> },
                { title: 'EIS', key: 'eis', width: 60, align: 'center' as const, render: (_: unknown, row) => <Dot on={row.schemes?.eis ?? null} title="EIS applies" /> },
                { title: 'Bank', key: 'bank', width: 64, align: 'center' as const, render: (_: unknown, row) => <Dot on={row.hasProfile ? row.bankAccountOnFile : null} title="Bank account on file" /> },
                {
                  title: 'Joined',
                  dataIndex: 'startDate',
                  width: 130,
                  render: (value: string | null) => (value ? dayjs(value).format('D MMM YYYY') : <span className="hr-faint">—</span>),
                },
                {
                  title: 'Record',
                  key: 'record',
                  width: 150,
                  render: (_: unknown, row) => {
                    const state = records.get(row.staffId);
                    return state ? (
                      <StatusChip tone={state.tone}>{state.label}</StatusChip>
                    ) : null;
                  },
                },
                {
                  title: '',
                  key: 'actions',
                  width: 130,
                  render: (_: unknown, row) => (
                    <span className="hr-menu" onClick={(event) => event.stopPropagation()}>
                      {row.hasProfile ? (
                        <button type="button" className="hr-btn hr-btn--sm" onClick={() => navigate(`/admin/hr/employees/${row.staffId}?tab=profile&edit=1`)}>
                          <IconEdit />
                          Edit
                        </button>
                      ) : (
                        <button type="button" className="hr-btn hr-btn--sm" onClick={() => setCompleting({ staffId: row.staffId, fullName: row.fullName })}>
                          Finish
                        </button>
                      )}
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: [
                            { key: 'view', label: 'View', disabled: !row.hasProfile },
                            { key: 'edit', label: 'Edit', disabled: !row.hasProfile },
                            { type: 'divider' },
                            {
                              key: 'resign',
                              label: 'Mark as resigned',
                              danger: true,
                              disabled: !mayManage || !row.hasProfile || GONE.has(row.employmentStatus ?? ''),
                            },
                            // For a record that should never have existed. The
                            // server refuses anybody paid or anybody who worked.
                            { key: 'delete', label: 'Delete record', danger: true, disabled: !mayManage },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'view') navigate(`/admin/hr/employees/${row.staffId}`);
                            if (key === 'edit') navigate(`/admin/hr/employees/${row.staffId}?tab=profile&edit=1`);
                            if (key === 'resign') setResigning({ staffId: row.staffId, fullName: row.fullName });
                            if (key === 'delete') setDeleting({ staffId: row.staffId, fullName: row.fullName });
                          },
                        }}
                      >
                        <button type="button" className="hr-btn hr-btn--sm hr-btn--icon" aria-label={`More for ${row.fullName}`}>
                          <IconMore />
                        </button>
                      </Dropdown>
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
        </>
      )}
    </HrPage>
  );
}
