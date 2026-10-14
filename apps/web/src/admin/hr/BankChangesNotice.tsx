import { useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { useBankChanges, useDecideBankChange } from '../hooks/useAdmin';
import { AuthImage, Drawer } from './ui';

/**
 * NEW BANK ACCOUNTS ASKED FOR IN MY KUWICK (testing, 15 October 2026). A
 * notice on Employees while any wait; the drawer shows the account on file
 * beside the new one and the proof photo. Approving copies the new account
 * onto the employee record; not approving needs a reason the employee sees.
 */
export function BankChangesNotice() {
  const { message } = App.useApp();
  const waiting = useBankChanges();
  const decide = useDecideBankChange();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const rows = waiting.data ?? [];
  if (rows.length === 0) return null;

  const act = (id: string, approve: boolean) =>
    decide.mutate(
      { id, approve, note: notes[id] },
      {
        onSuccess: () => message.success(approve ? 'Approved. Pay goes to the new account from the next payment.' : 'Sent back with your reason.'),
        onError: (error: Error) => message.error(error.message),
      },
    );

  return (
    <>
      <div className="hr-notice hr-notice--attn" data-testid="bank-changes-notice">
        {rows.length} new bank {rows.length === 1 ? 'account is' : 'accounts are'} waiting for you to check.{' '}
        <button type="button" className="hr-linkButton" onClick={() => setOpen(true)}>
          Check now
        </button>
      </div>
      <Drawer open={open} title="New bank accounts" sub="Check the photo matches the new account before you approve." onClose={() => setOpen(false)}>
        {rows.map((row) => (
          <div key={row.id} className="hr-panel" style={{ padding: 14, marginBottom: 12 }}>
            <b>{row.name}</b> <span className="hr-faint">· asked {dayjs(row.requestedAt).format('D MMM')}</span>
            <div className="hr-kv" style={{ marginTop: 8 }}>
              <span className="hr-kv__k">Now</span>
              <span className="hr-kv__v">{row.current ? `${row.current.bankName ?? ''} ${row.current.bankAccountNo} (${row.current.bankAccountName ?? '—'})` : 'No account on file'}</span>
              <span className="hr-kv__k">New</span>
              <span className="hr-kv__v">
                <b>
                  {row.next.bankName} {row.next.bankAccountNo}
                </b>{' '}
                ({row.next.bankAccountName})
              </span>
            </div>
            {row.proofPath ? <AuthImage path={row.proofPath} alt={`Bank proof for ${row.name}`} className="hr-proof" /> : null}
            <input
              className="hr-f"
              aria-label={`Reason if not approved, ${row.name}`}
              placeholder="Reason, if you do not approve"
              style={{ marginTop: 8 }}
              value={notes[row.id] ?? ''}
              onChange={(event) => setNotes({ ...notes, [row.id]: event.target.value })}
            />
            <div className="hr-formFoot">
              <button type="button" className="hr-btn" disabled={decide.isPending} onClick={() => act(row.id, false)}>
                Not approve
              </button>
              <button type="button" className="hr-btn hr-btn--primary" disabled={decide.isPending} onClick={() => act(row.id, true)}>
                Approve
              </button>
            </div>
          </div>
        ))}
      </Drawer>
    </>
  );
}
