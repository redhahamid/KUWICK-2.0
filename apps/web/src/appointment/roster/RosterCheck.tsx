import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';

interface RosterCheckResult {
  apiBuild: string;
  branchName: string | null;
  month: string;
  considered: number;
  included: number;
  includedPeople: { name: string; employeeNo: string | null; noBranch: boolean }[];
  excluded: { name: string; employeeNo: string | null; reason: string }[];
  inOtherBranches: { branch: string; count: number }[];
}

/**
 * THE ROSTER CHECK (UAT, 15 October 2026), owner only: how many people the
 * roster considered for this branch and month, and why anybody was left off,
 * with the API build that answered. Folded away until asked for.
 */
export function RosterCheck({ clinicId, month }: { clinicId: string; month: string }) {
  const isOwner = useCan('settings.manage');
  const [open, setOpen] = useState(false);
  const check = useQuery({
    queryKey: ['roster-check', clinicId, month],
    queryFn: () => apiClient.get<RosterCheckResult>(`/provider-shifts/roster-check?clinicId=${clinicId}&month=${month}`),
    enabled: isOwner && open,
  });
  if (!isOwner) return null;
  const data = check.data;
  return (
    <div className="kw-roster-check" data-testid="roster-check" style={{ marginBottom: 16, fontSize: 13 }}>
      <button type="button" className="hr-linkButton" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? 'Hide roster check' : 'Roster check (owner): who was considered and why'}
      </button>
      {open && check.isError ? <div role="alert">The check could not run: {check.error instanceof Error ? check.error.message : 'no answer'}</div> : null}
      {open && data ? (
        <div style={{ marginTop: 8 }}>
          <div>
            {data.branchName ?? 'This branch'}, {data.month}: {data.considered} people considered, <b>{data.included} on the roster</b>. API build{' '}
            <code>{data.apiBuild}</code>.
          </div>
          {data.inOtherBranches.length > 0 ? (
            <div>Recorded in other branches: {data.inOtherBranches.map((row) => `${row.branch} ${row.count}`).join(', ')}.</div>
          ) : null}
          {data.excluded.length > 0 ? (
            <table className="hr-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Left off</th>
                  <th>Employee No.</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {data.excluded.map((row) => (
                  <tr key={`${row.name}-${row.employeeNo ?? ''}`}>
                    <td>{row.name}</td>
                    <td>{row.employeeNo ?? '—'}</td>
                    <td>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div>Nobody in this branch was left off.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
