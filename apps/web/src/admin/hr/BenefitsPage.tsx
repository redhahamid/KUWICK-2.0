import { useMemo, useState } from 'react';
import { Select } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { FilterBar, Filter } from '../components/FilterBar';
import { PersonCell } from '../components/Person';
import { StatusChip, humanise } from '../components/Chip';
import { DetailDrawer, DrawerSection, LineItem, LineTotal } from '../components/DetailDrawer';
import { EmptyState } from '../components/Panel';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useStaffBenefits } from '../hooks/useAdmin';
import type { StaffBenefitAccountRow } from '../types';

/**
 * MEDICAL BENEFITS — the allowance, and what is left of it.
 *
 * A staff member has an annual allowance; their listed dependants draw on the
 * same pot. The balance is DERIVED from dated uses against invoices, the same
 * rule the stock ledger and the payment ledger follow — there is no running
 * "remaining" column for anybody to correct.
 *
 * IT IS ONE OF THE SIX SECTIONS, so it is drawn like one. It was the last of
 * them still wearing the old furniture: an expandable row of two bullet lists,
 * a number stepper for the year, and no way to see who is close to using their
 * allowance up. It now uses the same filter bar, person cell, status chips and
 * detail drawer as Payroll and Time & Leave — because somebody moving between
 * them should not feel they have changed product.
 *
 * READ-ONLY, deliberately. A use is recorded where the money is, at billing;
 * setting an allowance is a payroll-adjacent decision nobody has asked to move
 * here. Adding either would be inventing a workflow rather than showing one.
 */
export function BenefitsPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const [year, setYear] = useState<number>(dayjs().year());
  const [filter, setFilter] = useState('ALL');
  const [open, setOpen] = useState<string | undefined>();
  const benefits = useStaffBenefits({ year, clinicId });
  const accounts = benefits.data?.accounts ?? [];

  const allowance = accounts.reduce((total, row) => total + row.allowance, 0);
  const used = accounts.reduce((total, row) => total + row.used, 0);
  // ONE derivation of "remaining": the sum of the API's own per-account
  // figures (each clamped at zero server-side). The strip used to clamp ONCE
  // across the clinic — max(0, Σallowance − Σused) — so with one overdrawn
  // account the strip and the table footer showed two different ringgit
  // answers to the same question, and neither said which scope it meant.
  const remaining = accounts.reduce((total, row) => total + row.remaining, 0);
  const overdrawn = accounts.filter((row) => row.overdrawn > 0);
  // WHO IS ABOUT TO RUN OUT — the question this screen could not answer.
  // A list of balances says what has happened; a clinic wants to know who to
  // warn before somebody is turned away at the counter.
  const nearlyOut = accounts.filter(
    (row) => row.overdrawn === 0 && row.allowance > 0 && row.remaining / row.allowance <= 0.2,
  );

  const rows = useMemo(
    () =>
      accounts.filter((row) => {
        if (filter === 'OVERDRAWN') return row.overdrawn > 0;
        if (filter === 'LOW') return nearlyOut.some((entry) => entry.id === row.id);
        if (filter === 'UNUSED') return row.used === 0;
        if (filter === 'DEPENDANTS') return row.members.length > 0;
        return true;
      }),
    [accounts, filter, nearlyOut],
  );

  const selected = accounts.find((row) => row.id === open);
  const yearOptions = [0, 1, 2, 3].map((back) => {
    const value = dayjs().year() - back;
    return { value, label: String(value) };
  });

  return (
    <AdminShell
      error={firstError(benefits)}
      title="Medical Benefits"
      subtitle="The clinic's own people, their dependants, and what is left of this year's allowance."
    >
      <StatStrip
        stats={[
          { label: 'Accounts', value: accounts.length, hint: `benefit year ${year}` },
          { label: 'Allowance', value: money(allowance) },
          { label: 'Used', value: money(used), hint: allowance > 0 ? `${Math.round((used / allowance) * 100)}% of the pot` : undefined },
          { label: 'Remaining', value: money(remaining), hint: "sum of each account's balance", tone: 'good' },
          {
            label: 'Overdrawn',
            value: overdrawn.length,
            tone: overdrawn.length > 0 ? 'bad' : 'neutral',
            hint: overdrawn.length > 0 ? 'spent past the allowance' : 'Nobody has overspent',
          },
        ]}
      />

      <FilterBar>
        <Filter label="Benefit year">
          <Select size="small" style={{ width: 110 }} value={year} onChange={setYear} options={yearOptions} aria-label="Benefit year" />
        </Filter>
        {showSelector ? (
          <Filter label="Branch">
            <Select
              size="small"
              style={{ width: 180 }}
              allowClear
              placeholder="All branches"
              value={clinicId}
              onChange={(value) => setClinicId(value)}
              options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            />
          </Filter>
        ) : null}
        <Filter label="Show">
          <Select
            size="small"
            style={{ width: 190 }}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: 'Every account' },
              { value: 'LOW', label: 'Nearly used up' },
              { value: 'OVERDRAWN', label: 'Overdrawn' },
              { value: 'UNUSED', label: 'Nothing drawn' },
              { value: 'DEPENDANTS', label: 'With dependants' },
            ]}
          />
        </Filter>
      </FilterBar>

      {nearlyOut.length > 0 && filter === 'ALL' ? (
        <AdminNotice tone="warn">
          <strong>
            {nearlyOut.length} {nearlyOut.length === 1 ? 'person has' : 'people have'} a fifth or less of their
            allowance left.
          </strong>{' '}
          Worth saying before somebody is surprised at the counter:{' '}
          {nearlyOut
            .slice(0, 5)
            .map((row) => row.staffName)
            .join(', ')}
          {nearlyOut.length > 5 ? ` and ${nearlyOut.length - 5} more.` : '.'}
        </AdminNotice>
      ) : null}

      <AdminNotice>{benefits.data?.note}</AdminNotice>

      <AdminSection padded={false}>
        <DataTable<StaffBenefitAccountRow>
          rowKey="id"
          rows={rows}
          loading={benefits.isLoading}
          searchPlaceholder="Search staff…"
          searchFields={['staffName', 'clinicName']}
          exportName={`staff-benefits-${year}`}
          emptyText={filter === 'ALL' ? `No benefit accounts for ${year}` : 'Nobody matches that filter'}
          scrollY={520}
          onRow={(row) => ({ onClick: () => setOpen(row.id) })}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'staffName',
              key: 'staffName',
              width: 230,
              render: (value: string, row) => {
                // THE MEMBER IS NOT A DEPENDANT. Every account carries a SELF
                // row for the employee, so counting members reported "1
                // dependant" for somebody with none.
                const dependants = row.members.filter((member) => member.relationship !== 'SELF').length;
                return (
                  <PersonCell
                    name={value}
                    meta={
                      dependants > 0
                        ? `${dependants} dependant${dependants === 1 ? '' : 's'} draw on this account`
                        : 'No dependants'
                    }
                  />
                );
              },
            },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName', width: 150 },
            {
              title: 'Allowance',
              dataIndex: 'allowance',
              key: 'allowance',
              width: 120,
              align: 'right' as const,
              render: (value: number) => money(value),
            },
            {
              title: 'Used',
              dataIndex: 'used',
              key: 'used',
              width: 120,
              align: 'right' as const,
              render: (value: number) => (value ? money(value) : <span className="kw-muted">—</span>),
            },
            {
              // A BAR, NOT ONLY A NUMBER. "RM240 of RM800" is arithmetic the
              // reader has to do on every row; the bar answers "is this person
              // near the end" at a glance and the figure stays beside it.
              title: 'Used against allowance',
              key: 'progress',
              width: 190,
              noExport: true,
              render: (_: unknown, row) => {
                const pct = row.allowance > 0 ? Math.min(100, Math.round((row.used / row.allowance) * 100)) : 0;
                const tone = row.overdrawn > 0 ? 'blocked' : pct >= 80 ? 'attention' : 'ok';
                return (
                  <div className={`kw-meter kw-meter--${tone === 'blocked' ? 'bad' : tone === 'attention' ? 'attention' : 'ok'}`}>
                    <div className="kw-meter__track">
                      <div className="kw-meter__fill" style={{ width: `${row.overdrawn > 0 ? 100 : pct}%` }} />
                    </div>
                    <span className="kw-meter__text">
                      {money(row.used)} of {money(row.allowance)}
                    </span>
                  </div>
                );
              },
            },
            {
              title: 'Remaining',
              dataIndex: 'remaining',
              key: 'remaining',
              width: 150,
              align: 'right' as const,
              render: (value: number, row) =>
                row.overdrawn > 0 ? (
                  <StatusChip tone="blocked" dot>
                    Overdrawn {money(row.overdrawn)}
                  </StatusChip>
                ) : (
                  <strong>{money(value)}</strong>
                ),
            },
            {
              title: '',
              key: 'action',
              width: 90,
              noExport: true,
              render: () => (
                <span className="kw-rowAction" style={{ fontSize: 12 }}>
                  View →
                </span>
              ),
            },
          ]}
        />
      </AdminSection>

      {/*
        * ONE ACCOUNT, AS A DRAWER — the dependants who draw on it and every
        * dated use that made up the balance. It used to be an expanded row of
        * two bullet lists, which pushed the rest of the table down the screen
        * exactly when somebody was comparing one account against the others.
        */}
      <DetailDrawer
        open={Boolean(selected)}
        onClose={() => setOpen(undefined)}
        name={selected?.staffName ?? ''}
        subtitle={`${selected?.clinicName ?? ''} · benefit year ${year}`}
        width={520}
        tags={
          selected ? (
            selected.overdrawn > 0 ? (
              <StatusChip tone="blocked">Overdrawn {money(selected.overdrawn)}</StatusChip>
            ) : (
              <StatusChip tone="ok" dot>
                {money(selected.remaining)} left
              </StatusChip>
            )
          ) : null
        }
        footer={
          selected ? (
            <>
              <span className="kw-netLabel">Remaining</span>
              <span className="kw-netValue">
                {selected.overdrawn > 0 ? `−${money(selected.overdrawn)}` : money(selected.remaining)}
              </span>
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <DrawerSection title="Allowance">
              <LineItem label="Annual allowance" value={money(selected.allowance)} />
              <LineItem label="Drawn this year" value={`−${money(selected.used)}`} tone="deduct" />
              <LineTotal
                label="Remaining"
                value={selected.overdrawn > 0 ? `−${money(selected.overdrawn)}` : money(selected.remaining)}
                tone={selected.overdrawn > 0 ? 'deduct' : undefined}
              />
            </DrawerSection>

            <DrawerSection title="Who draws on this account">
              {selected.members.length === 0 ? (
                <EmptyState title="Nobody else draws on this account" />
              ) : (
                selected.members.map((member) => (
                  <LineItem
                    key={member.id}
                    label={member.name}
                    value={
                      member.allowanceOverride !== null ? (
                        money(member.allowanceOverride)
                      ) : (
                        <span className="kw-muted">shares the pot</span>
                      )
                    }
                    source={`${humanise(member.relationship)}${member.linkedPatient ? ' · linked patient record' : ''}`}
                  />
                ))
              )}
            </DrawerSection>

            <DrawerSection title={`Uses · ${selected.usages.length}`}>
              {selected.usages.length === 0 ? (
                <EmptyState title="Nothing drawn this year" />
              ) : (
                selected.usages.map((usage) => (
                  <LineItem
                    key={usage.id}
                    label={`${dayjs(usage.usedAt).format('D MMM YYYY')} · ${usage.forWhom}`}
                    value={`−${money(usage.amount)}`}
                    tone="deduct"
                    source={`${usage.invoiceNumber ? `${usage.invoiceNumber} · ` : ''}recorded by ${usage.recordedBy}`}
                  />
                ))
              )}
            </DrawerSection>
          </>
        ) : null}
      </DetailDrawer>
    </AdminShell>
  );
}
