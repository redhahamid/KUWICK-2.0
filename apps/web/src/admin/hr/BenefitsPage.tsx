import { useState } from 'react';
import { InputNumber, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, DataTableTotals, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useStaffBenefits } from '../hooks/useAdmin';
import type { StaffBenefitAccountRow } from '../types';

/**
 * STAFF MEDICAL BENEFIT — the allowance, and what is left of it.
 *
 * A staff member has an annual allowance; their listed dependants draw on the
 * same pot. The balance is DERIVED from dated uses against invoices, the same
 * rule the stock ledger and the payment ledger follow — there is no running
 * "remaining" column for anybody to correct.
 *
 * READ-ONLY, deliberately. A use is recorded where the money is, at billing;
 * setting an allowance is a payroll-adjacent decision nobody has asked to move
 * here. Adding either would be inventing a workflow rather than showing one.
 */
export function BenefitsPage() {
  const { clinicId } = useClinicFilter();
  const [year, setYear] = useState<number>(dayjs().year());
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

  return (
    <AdminShell
      error={firstError(benefits)}
      title="Medical Benefits"
      subtitle="The clinic’s own people, their dependants, and what is left of this year’s allowance."
      actions={
        <InputNumber
          size="small"
          value={year}
          min={2020}
          max={2100}
          onChange={(value) => value && setYear(value)}
          style={{ width: 110 }}
          aria-label="Benefit year"
        />
      }
    >
      <StatStrip
        stats={[
          { label: 'Accounts', value: String(accounts.length), hint: `benefit year ${year}` },
          { label: 'Allowance', value: money(allowance) },
          { label: 'Used', value: money(used), tone: 'neutral' },
          { label: 'Remaining', value: money(remaining), hint: 'sum of each account’s balance', tone: 'good' },
          {
            label: 'Overdrawn',
            value: String(overdrawn.length),
            tone: overdrawn.length > 0 ? 'bad' : 'neutral',
            hint: 'spent past the allowance',
          },
        ]}
      />

      <AdminNotice>{benefits.data?.note}</AdminNotice>

      <AdminSection
        title="Accounts"
        description="Open a row to see the dependants on it and every use that made up the balance."
        padded={false}
      >
        <DataTable<StaffBenefitAccountRow>
          rowKey="id"
          rows={accounts}
          loading={benefits.isLoading}
          searchPlaceholder="Search staff…"
          searchFields={['staffName', 'clinicName']}
          exportName={`staff-benefits-${year}`}
          emptyText={`No benefit accounts for ${year}`}
          expandable={{
            expandedRowRender: (row) => (
              <div className="kw-benefitDetail">
                <div>
                  <h4>Dependants</h4>
                  {row.members.length === 0 ? (
                    <p className="kw-muted">Nobody else draws on this account.</p>
                  ) : (
                    <ul className="kw-adminList">
                      {row.members.map((member) => (
                        <li key={member.id}>
                          {member.name} <Tag>{member.relationship}</Tag>
                          {member.allowanceOverride !== null ? (
                            <span className="kw-muted"> own limit {money(member.allowanceOverride)}</span>
                          ) : null}
                          {member.linkedPatient ? <Tag color="blue">Linked patient</Tag> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4>Uses</h4>
                  {row.usages.length === 0 ? (
                    <p className="kw-muted">Nothing drawn this year.</p>
                  ) : (
                    <ul className="kw-adminList">
                      {row.usages.map((usage) => (
                        <li key={usage.id}>
                          {dayjs(usage.usedAt).format('D MMM YY')} · <strong>{money(usage.amount)}</strong> ·{' '}
                          {usage.forWhom}
                          {usage.invoiceNumber ? <span className="kw-muted"> · {usage.invoiceNumber}</span> : null}
                          <span className="kw-muted"> · recorded by {usage.recordedBy}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ),
          }}
          columns={[
            { title: 'Staff', dataIndex: 'staffName', key: 'staffName' },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName', optional: true },
            { title: 'Dependants', key: 'members', render: (_: unknown, row) => row.members.length, className: 'kw-num' },
            {
              title: 'Allowance',
              dataIndex: 'allowance',
              key: 'allowance',
              className: 'kw-num',
              render: (value: number) => money(value),
            },
            {
              title: 'Used',
              dataIndex: 'used',
              key: 'used',
              className: 'kw-num',
              render: (value: number) => money(value),
            },
            {
              title: 'Remaining',
              dataIndex: 'remaining',
              key: 'remaining',
              className: 'kw-num',
              render: (value: number, row) =>
                row.overdrawn > 0 ? (
                  <span className="kw-bad">overdrawn {money(row.overdrawn)}</span>
                ) : (
                  <strong>{money(value)}</strong>
                ),
            },
          ]}
          summary={(shown) => (
            <DataTableTotals
              countLabel="account(s)"
              label="remaining"
              count={shown.length}
              total={shown.reduce((sum, row) => sum + (row as StaffBenefitAccountRow).remaining, 0)}
            />
          )}
        />
      </AdminSection>
    </AdminShell>
  );
}
