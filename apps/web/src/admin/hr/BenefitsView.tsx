import { type ReactNode, useMemo, useState } from 'react';
import { Select } from 'antd';
import dayjs from 'dayjs';
import { useStaffBenefits } from '../hooks/useAdmin';
import { money } from '../components/DataTable';
import { initialsOf } from './ui/who';
import { humanise } from '../components/Chip';
import { Drawer, Panel, SegControl, StatCard, StatRow, StatusChip } from './ui';
import { Table } from './ui/Table';
import type { StaffBenefitAccountRow } from '../types';

/**
 * MEDICAL BENEFITS — the clinic's own people, their dependants, and what is
 * left of this year's allowance. A view of the Employees screen now, as
 * decided in Piece 1: it is a fact about employees, not a place of its own.
 *
 * The data and every rule below are the old page's. One derivation of
 * "remaining": the sum of the API's own per-account figures, each clamped at
 * zero server-side, so the strip and the table agree.
 */
type Filter = 'ALL' | 'LOW' | 'OVERDRAWN' | 'UNUSED' | 'DEPENDANTS';

export function BenefitsView({ clinicId, tabs }: { clinicId?: string; tabs: ReactNode }) {
  const [year, setYear] = useState<number>(dayjs().year());
  const [filter, setFilter] = useState<Filter>('ALL');
  const [open, setOpen] = useState<string | undefined>();
  const benefits = useStaffBenefits({ year, clinicId });
  const accounts = benefits.data?.accounts ?? [];

  const allowance = accounts.reduce((total, row) => total + row.allowance, 0);
  const used = accounts.reduce((total, row) => total + row.used, 0);
  const remaining = accounts.reduce((total, row) => total + row.remaining, 0);
  const overdrawn = accounts.filter((row) => row.overdrawn > 0);
  // WHO IS ABOUT TO RUN OUT — the question a list of balances cannot answer.
  const nearlyOut = accounts.filter((row) => row.overdrawn === 0 && row.allowance > 0 && row.remaining / row.allowance <= 0.2);

  const rows = useMemo(
    () =>
      accounts.filter((row) => {
        if (filter === 'OVERDRAWN') return row.overdrawn > 0;
        if (filter === 'LOW') return nearlyOut.some((entry) => entry.id === row.id);
        if (filter === 'UNUSED') return row.used === 0;
        if (filter === 'DEPENDANTS') return row.members.some((member) => member.relationship !== 'SELF');
        return true;
      }),
    [accounts, filter, nearlyOut],
  );
  const selected = accounts.find((row) => row.id === open);
  const yearOptions = [0, 1, 2, 3].map((back) => ({ value: dayjs().year() - back, label: String(dayjs().year() - back) }));

  return (
    <>
      <StatRow>
        <StatCard label="Accounts" value={accounts.length} sub={`Benefit year ${year}`} />
        <StatCard label="Allowance" value={money(allowance)} sub="For the year" />
        <StatCard label="Used" value={money(used)} sub={allowance > 0 ? `${Math.round((used / allowance) * 100)}% of the pot` : undefined} />
        <StatCard
          label={overdrawn.length > 0 ? 'Overdrawn' : 'Remaining'}
          value={overdrawn.length > 0 ? overdrawn.length : money(remaining)}
          tone={overdrawn.length > 0 ? 'red' : 'plain'}
          sub={overdrawn.length > 0 ? 'Spent past the allowance' : "Sum of each account's balance"}
        />
      </StatRow>

      <Panel>
        {tabs}
        <Table<StaffBenefitAccountRow>
          rowKey="id"
          rows={rows}
          loading={benefits.isLoading}
          searchFields={['staffName', 'clinicName']}
          searchPlaceholder="Search staff"
          searchLabel="Search staff"
          emptyText={filter === 'ALL' ? `No benefit accounts for ${year}.` : 'Nobody matches that filter.'}
          onRow={(row) => ({ onClick: () => setOpen(row.id) })}
          toolbar={
            <>
              <Select
                size="small"
                style={{ width: 96 }}
                value={year}
                onChange={setYear}
                options={yearOptions}
                aria-label="Benefit year"
              />
              <SegControl<Filter>
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'ALL', label: 'All' },
                  { value: 'LOW', label: 'Nearly used up' },
                  { value: 'OVERDRAWN', label: 'Overdrawn' },
                  { value: 'UNUSED', label: 'Nothing drawn' },
                  { value: 'DEPENDANTS', label: 'With dependants' },
                ]}
              />
            </>
          }
          toolbarRight={
            nearlyOut.length > 0 && filter === 'ALL' ? (
              <span className="hr-small hr-muted">
                {nearlyOut.length} {nearlyOut.length === 1 ? 'person has' : 'people have'} a fifth or less left:{' '}
                {nearlyOut
                  .slice(0, 3)
                  .map((row) => row.staffName)
                  .join(', ')}
                {nearlyOut.length > 3 ? ` and ${nearlyOut.length - 3} more` : ''}
              </span>
            ) : null
          }
          columns={[
            {
              title: 'Employee',
              dataIndex: 'staffName',
              render: (value: string, row) => {
                // THE MEMBER IS NOT A DEPENDANT: every account carries a SELF row.
                const dependants = row.members.filter((member) => member.relationship !== 'SELF').length;
                return (
                  <div className="hr-who">
                    <span className="hr-who__avatar">{initialsOf(value)}</span>
                    <div>
                      <div className="hr-who__name">{value}</div>
                      <div className="hr-who__role">
                        {dependants > 0 ? `${dependants} dependant${dependants === 1 ? '' : 's'} draw on this account` : 'No dependants'}
                      </div>
                    </div>
                  </div>
                );
              },
            },
            { title: 'Branch', dataIndex: 'clinicName', render: (value: string | null) => value ?? <span className="hr-faint">—</span> },
            { title: 'Allowance', dataIndex: 'allowance', num: true, width: 120, render: (value: number) => money(value) },
            {
              title: 'Used',
              dataIndex: 'used',
              num: true,
              width: 120,
              render: (value: number) => (value ? money(value) : <span className="hr-faint">—</span>),
            },
            {
              title: 'Remaining',
              dataIndex: 'remaining',
              num: true,
              width: 170,
              render: (value: number, row) =>
                row.overdrawn > 0 ? (
                  <StatusChip tone="block">Overdrawn {money(row.overdrawn)}</StatusChip>
                ) : (
                  <span className="hr-strong">{money(value)}</span>
                ),
            },
          ]}
        />
        {benefits.data?.note ? <div className="hr-panelNote">{benefits.data.note}</div> : null}
      </Panel>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setOpen(undefined)}
        title={selected?.staffName ?? ''}
        sub={`${selected?.clinicName ?? 'All branches'} · benefit year ${year}`}
      >
        {selected ? (
          <>
            <div className="hr-kv" style={{ padding: 0 }}>
              <span className="hr-kv__k">Annual allowance</span>
              <span className="hr-kv__v">{money(selected.allowance)}</span>
              <span className="hr-kv__k">Drawn this year</span>
              <span className="hr-kv__v hr-neg">−{money(selected.used)}</span>
              <span className="hr-kv__k hr-strong">Remaining</span>
              <span className={`hr-kv__v hr-strong${selected.overdrawn > 0 ? ' hr-neg' : ''}`}>
                {selected.overdrawn > 0 ? `−${money(selected.overdrawn)}` : money(selected.remaining)}
              </span>
            </div>

            <h3 className="hr-form__group" style={{ marginTop: 18 }}>
              Who draws on this account
            </h3>
            {selected.members.length === 0 ? (
              <div className="hr-small hr-muted">Nobody else draws on this account.</div>
            ) : (
              <div className="hr-kv" style={{ padding: 0 }}>
                {selected.members.map((member) => (
                  <span key={member.id} style={{ display: 'contents' }}>
                    <span className="hr-kv__k">
                      {member.name}
                      <span className="hr-faint hr-small">
                        {' '}
                        · {humanise(member.relationship)}
                        {member.linkedPatient ? ' · linked patient record' : ''}
                      </span>
                    </span>
                    <span className="hr-kv__v">
                      {member.allowanceOverride !== null ? money(member.allowanceOverride) : <span className="hr-faint">shares the pot</span>}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <h3 className="hr-form__group" style={{ marginTop: 18 }}>
              Uses · {selected.usages.length}
            </h3>
            {selected.usages.length === 0 ? (
              <div className="hr-small hr-muted">Nothing drawn this year.</div>
            ) : (
              <div className="hr-kv" style={{ padding: 0 }}>
                {selected.usages.map((usage) => (
                  <span key={usage.id} style={{ display: 'contents' }}>
                    <span className="hr-kv__k">
                      {dayjs(usage.usedAt).format('D MMM YYYY')} · {usage.forWhom}
                      <span className="hr-faint hr-small">
                        {' '}
                        · {usage.invoiceNumber ? `${usage.invoiceNumber} · ` : ''}recorded by {usage.recordedBy}
                      </span>
                    </span>
                    <span className="hr-kv__v hr-neg">−{money(usage.amount)}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        ) : null}
      </Drawer>
    </>
  );
}
