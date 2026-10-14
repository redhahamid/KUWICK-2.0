import { useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../core/api-client';
import { PanelHead, StatusChip } from '../admin/hr/ui';
import { IconDoc } from '../admin/hr/ui/icons';
import {
  uploadMyFile,
  useCancelBankChange,
  useMyBankChange,
  useRequestBankChange,
  useUpdateMyContact,
  type MyContact,
  type MyProfile,
} from './hooks/useMe';

/**
 * MY DETAILS (testing, 15 October 2026): contact details the employee keeps
 * up to date themselves, and a new bank account they ask for, which HR
 * checks against a photo before pay goes there.
 */

const CONTACT_FIELDS: { key: keyof MyContact; label: string; inputMode?: 'tel' | 'email' | 'numeric' }[] = [
  { key: 'phone', label: 'Phone', inputMode: 'tel' },
  { key: 'email', label: 'Email', inputMode: 'email' },
  { key: 'address', label: 'Address' },
  { key: 'postcode', label: 'Postcode', inputMode: 'numeric' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'emergencyContactName', label: 'Emergency contact' },
  { key: 'emergencyContactPhone', label: 'Their phone', inputMode: 'tel' },
  { key: 'emergencyContactRelation', label: 'Relationship' },
];

export function ContactPanel({ employment }: { employment: MyProfile['employment'] }) {
  const { message } = App.useApp();
  const save = useUpdateMyContact();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MyContact>({});

  const start = () => {
    setForm(Object.fromEntries(CONTACT_FIELDS.map(({ key }) => [key, employment?.[key] ?? ''])) as MyContact);
    setEditing(true);
  };
  const submit = () =>
    save.mutate(form, {
      onSuccess: () => {
        message.success('Your details are saved.');
        setEditing(false);
      },
      onError: (error) => message.error(error instanceof ApiError ? error.message : 'Could not save your details.'),
    });

  return (
    <>
      <PanelHead
        title="Contact"
        actions={
          employment && !editing ? (
            <button type="button" className="hr-btn hr-btn--sm" onClick={start}>
              Edit
            </button>
          ) : null
        }
      />
      {editing ? (
        <div className="hr-pform" style={{ padding: '0 0 12px' }}>
          {CONTACT_FIELDS.map(({ key, label, inputMode }) => (
            <div key={key} className={key === 'address' ? 'hr-pform__full' : undefined}>
              <label htmlFor={`me-${key}`}>{label}</label>
              <input
                id={`me-${key}`}
                className="hr-f"
                inputMode={inputMode}
                value={form[key] ?? ''}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            </div>
          ))}
          <div className="hr-pform__full hr-formFoot">
            <button type="button" className="hr-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" disabled={save.isPending} onClick={submit}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="hr-kv">
          {CONTACT_FIELDS.map(({ key, label }) => (
            <span key={key} style={{ display: 'contents' }}>
              <span className="hr-kv__k">{label}</span>
              <span className="hr-kv__v">{employment?.[key] || '—'}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

const REQUEST_CHIP: Record<string, { tone: 'attn' | 'done' | 'block' | 'muted'; label: string }> = {
  PENDING: { tone: 'attn', label: 'Waiting for HR' },
  APPROVED: { tone: 'done', label: 'Approved' },
  REJECTED: { tone: 'block', label: 'Not approved' },
  CANCELLED: { tone: 'muted', label: 'Cancelled' },
};

export function BankPanel({ hasEmploymentProfile }: { hasEmploymentProfile: boolean }) {
  const { message } = App.useApp();
  const { data } = useMyBankChange();
  const request = useRequestBankChange();
  const cancel = useCancelBankChange();
  const [open, setOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [accountName, setAccountName] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const ready = bankName.trim().length >= 2 && /^\d{6,30}$/.test(accountNo) && accountName.trim().length >= 2 && proof;
  const submit = async () => {
    if (!ready || !proof) return;
    setSending(true);
    try {
      const file = await uploadMyFile('BANK_PROOF', proof, proof.name);
      await request.mutateAsync({ bankName: bankName.trim(), bankAccountNo: accountNo, bankAccountName: accountName.trim(), proofFileId: file.id });
      message.success('Sent to HR. Your pay keeps going to the old account until they approve.');
      setOpen(false);
      setBankName('');
      setAccountNo('');
      setAccountName('');
      setProof(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not send that.');
    } finally {
      setSending(false);
    }
  };

  const last = data?.request ?? null;
  const chip = last ? (REQUEST_CHIP[last.status] ?? { tone: 'muted' as const, label: last.status }) : null;

  return (
    <>
      <PanelHead
        title="Bank account"
        actions={
          hasEmploymentProfile && !open ? (
            <button type="button" className="hr-btn hr-btn--sm" onClick={() => setOpen(true)}>
              Change
            </button>
          ) : null
        }
      />
      <div className="hr-kv">
        <span className="hr-kv__k">Pay goes to</span>
        <span className="hr-kv__v">{data?.current ? `${data.current.bankName ?? 'Bank'} •••• ${data.current.lastFour}` : 'No account on file yet'}</span>
        {last && chip ? (
          <>
            <span className="hr-kv__k">Change asked for</span>
            <span className="hr-kv__v">
              {last.bankName} •••• {last.lastFour}, {dayjs(last.createdAt).format('D MMM')} <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
              {last.decisionNote ? <div className="hr-tdSub">{last.decisionNote}</div> : null}
              {last.status === 'PENDING' ? (
                <button
                  type="button"
                  className="hr-btn hr-btn--sm hr-btn--ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(last.id, { onSuccess: () => message.success('Request cancelled.') })}
                >
                  Cancel request
                </button>
              ) : null}
            </span>
          </>
        ) : null}
      </div>
      {open ? (
        <div className="hr-pform" style={{ paddingTop: 12 }}>
          <div>
            <label htmlFor="bank-name">Bank</label>
            <input id="bank-name" className="hr-f" placeholder="e.g. Maybank" value={bankName} onChange={(event) => setBankName(event.target.value)} />
          </div>
          <div>
            <label htmlFor="bank-no">Account number</label>
            <input id="bank-no" className="hr-f" inputMode="numeric" value={accountNo} onChange={(event) => setAccountNo(event.target.value.replace(/\D/g, ''))} />
          </div>
          <div className="hr-pform__full">
            <label htmlFor="bank-holder">Name on the account</label>
            <input id="bank-holder" className="hr-f" value={accountName} onChange={(event) => setAccountName(event.target.value)} />
          </div>
          <div className="hr-pform__full">
            <label htmlFor="bank-proof">Proof it is yours (statement header or bank card)</label>
            <label className="hr-drop is-required" htmlFor="bank-proof">
              <IconDoc />
              {proof ? proof.name : 'Take a photo or choose a file — needed'}
              <input id="bank-proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="hr-pform__full hr-formFoot">
            <button type="button" className="hr-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" disabled={!ready || sending} onClick={submit}>
              Send to HR
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
