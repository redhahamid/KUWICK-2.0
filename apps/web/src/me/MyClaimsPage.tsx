import { useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../core/api-client';
import { Panel, PanelHead, StatusChip } from '../admin/hr/ui';
import { IconDoc } from '../admin/hr/ui/icons';
import { AuthImage } from './clock';
import { myFilePath, uploadMyFile, useMyBenefits, useMyClaimPolicy, useMyClaims, useSubmitClaim, type MyClaim } from './hooks/useMe';
import { IconCheckCircle, PortalEmpty, monthShort, rm } from './portal';

/**
 * WHAT A CLAIM CAN BE FOR. Mileage is the API's TRAVEL category with the
 * distance worked out here; the API stores one amount and one description,
 * so the journey and the kilometres are written into the description where
 * the manager reads them.
 */
const TYPES = [
  { value: 'MILEAGE', label: 'Mileage', category: 'TRAVEL' },
  { value: 'MEDICAL', label: 'Medical', category: 'MEDICAL' },
  { value: 'MEAL', label: 'Meals', category: 'MEAL' },
  { value: 'TRAVEL', label: 'Travel (fares, parking, tolls)', category: 'TRAVEL' },
  { value: 'TRAINING', label: 'Training', category: 'TRAINING' },
  { value: 'EQUIPMENT', label: 'Equipment', category: 'EQUIPMENT' },
  { value: 'PROFESSIONAL_FEE', label: 'Professional fee', category: 'PROFESSIONAL_FEE' },
  { value: 'OTHER', label: 'Other', category: 'OTHER' },
] as const;

/**
 * [D] RM per kilometre comes from the clinic's claim policy (Settings ›
 * Claims, `ClaimPolicy.mileageRatePerKm`); the server prices the claim with
 * the same rate and freezes it on the row. This default only stands in
 * while the policy is still loading, and matches the policy's own default
 * (the mockup's 42 km at RM 25.20).
 */
export const DEFAULT_MILEAGE_RATE_RM = 0.6;

/** A stored file's id from the path the API keeps on the attachment (`/me/files/<id>`). */
function fileIdOf(filePath: string): string | null {
  return filePath.startsWith('/me/files/') ? filePath.slice('/me/files/'.length) : null;
}

const CATEGORY_WORD: Record<string, string> = {
  MEDICAL: 'Medical',
  TRAVEL: 'Travel',
  MEAL: 'Meals',
  TRAINING: 'Training',
  EQUIPMENT: 'Equipment',
  PROFESSIONAL_FEE: 'Professional fee',
  OTHER: 'Other',
};

/** The chip on a row: where the money is, in one word or two. */
export function claimChip(claim: Pick<MyClaim, 'status' | 'whereTheMoneyIs' | 'payrollPeriod'>): {
  tone: 'attn' | 'done' | 'block' | 'muted';
  label: string;
} {
  if (claim.status === 'SUBMITTED') return { tone: 'attn', label: 'Waiting' };
  if (claim.status === 'REJECTED') return { tone: 'block', label: 'Not approved' };
  if (claim.status === 'CANCELLED') return { tone: 'muted', label: 'Withdrawn' };
  if (claim.status === 'DRAFT') return { tone: 'muted', label: 'Draft' };
  if (/^Paid|^Reimbursed/.test(claim.whereTheMoneyIs)) {
    return { tone: 'muted', label: claim.payrollPeriod ? `Paid ${monthShort(claim.payrollPeriod)}` : 'Paid' };
  }
  return { tone: 'done', label: 'Approved' };
}

export function mileageAmount(km: number, ratePerKm: number = DEFAULT_MILEAGE_RATE_RM): number {
  return Math.round(km * ratePerKm * 100) / 100;
}

export function MyClaimsPage() {
  const { message } = App.useApp();
  const { data: claims, isLoading } = useMyClaims();
  const { data: benefits } = useMyBenefits();
  const { data: policy } = useMyClaimPolicy();
  const submit = useSubmitClaim();
  const [sending, setSending] = useState(false);

  const [type, setType] = useState<(typeof TYPES)[number]['value']>('MILEAGE');
  const [claimDate, setClaimDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [fromPlace, setFromPlace] = useState('');
  const [toPlace, setToPlace] = useState('');
  const [distance, setDistance] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  const mileage = type === 'MILEAGE';
  const km = Number(distance);
  const ratePerKm = policy ? Number(policy.mileageRatePerKm) : DEFAULT_MILEAGE_RATE_RM;
  const receiptRequired = policy?.receiptRequired ?? true;
  const computed = mileage && Number.isFinite(km) && km > 0 ? mileageAmount(km, ratePerKm) : null;

  useEffect(() => {
    if (!receipt || !receipt.type.startsWith('image/')) {
      setReceiptUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(receipt);
    setReceiptUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [receipt]);

  const reset = () => {
    setType('MILEAGE');
    setClaimDate(dayjs().format('YYYY-MM-DD'));
    setFromPlace('');
    setToPlace('');
    setDistance('');
    setAmount('');
    setPurpose('');
    setReceipt(null);
  };

  const finalAmount = computed ?? Number(amount);
  const canSubmit =
    (Boolean(receipt) || !receiptRequired) &&
    purpose.trim().length >= 3 &&
    Number.isFinite(finalAmount) &&
    finalAmount > 0 &&
    (!mileage || (fromPlace.trim() && toPlace.trim()));

  const send = async () => {
    if (!canSubmit) return;
    const category = TYPES.find((row) => row.value === type)?.category ?? 'OTHER';
    const description = mileage
      ? `Mileage ${km} km, ${fromPlace.trim()} to ${toPlace.trim()}: ${purpose.trim()}`
      : purpose.trim();
    setSending(true);
    try {
      // The receipt goes up first as the person's own file (bytes and all);
      // the claim then points at it, so a failed upload leaves no claim
      // behind. [D] Mileage is priced by the server from the distance and
      // the clinic's rate; the amount shown here is the same sum, for the
      // person to see before they send it.
      const uploaded = receipt ? await uploadMyFile('RECEIPT', receipt, receipt.name) : null;
      const claim = await submit.mutateAsync({
        category,
        amountClaimed: finalAmount.toFixed(2),
        claimDate,
        description,
        distanceKm: mileage ? km : undefined,
        receiptFileId: uploaded?.id,
      });
      message.success(`Sent to your manager: ${rm(claim.amountClaimed)}.`);
      reset();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not send that.');
    } finally {
      setSending(false);
    }
  };

  const medical = benefits?.medical ?? null;
  const usedShare = useMemo(() => {
    if (!medical) return 0;
    const allowance = Number(medical.allowance);
    return allowance > 0 ? Math.min(100, Math.round((Number(medical.used) / allowance) * 100)) : 0;
  }, [medical]);

  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>Submit a claim</h1>
          <div className="hr-sub">Attach the receipt. Approved claims are paid with your next payslip.</div>
        </div>
      </div>

      <div className="hr-grid2 hr-grid2--wide">
        <Panel>
          <div style={{ padding: '20px 22px' }}>
            <div className="hr-pform">
              <div>
                <label htmlFor="claim-type">Type</label>
                <select
                  id="claim-type"
                  className="hr-f"
                  value={type}
                  onChange={(event) => setType(event.target.value as (typeof TYPES)[number]['value'])}
                >
                  {TYPES.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="claim-date">Expense / travel date</label>
                <input
                  id="claim-date"
                  type="date"
                  className="hr-f"
                  value={claimDate}
                  max={dayjs().format('YYYY-MM-DD')}
                  onChange={(event) => setClaimDate(event.target.value)}
                />
              </div>
              {mileage ? (
                <>
                  <div>
                    <label htmlFor="claim-from">From</label>
                    <input id="claim-from" className="hr-f" value={fromPlace} onChange={(event) => setFromPlace(event.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="claim-to">To</label>
                    <input id="claim-to" className="hr-f" value={toPlace} onChange={(event) => setToPlace(event.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="claim-km">Distance</label>
                    <input
                      id="claim-km"
                      className="hr-f"
                      inputMode="decimal"
                      placeholder="km"
                      value={distance}
                      onChange={(event) => setDistance(event.target.value.replace(/[^\d.]/g, ''))}
                    />
                  </div>
                  <div>
                    <label htmlFor="claim-amount">Amount</label>
                    <div id="claim-amount" className="hr-f hr-f--auto" aria-live="polite">
                      {computed !== null ? (
                        <>
                          {rm(computed)} <small>· {km} × RM {ratePerKm.toFixed(2)}</small>
                        </>
                      ) : (
                        <small>Worked out from the distance</small>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="claim-amount">Amount (RM)</label>
                  <input
                    id="claim-amount"
                    className="hr-f"
                    inputMode="decimal"
                    placeholder="45.50"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                  />
                </div>
              )}
              <div className="hr-pform__full">
                <label htmlFor="claim-purpose">Purpose</label>
                <input
                  id="claim-purpose"
                  className="hr-f"
                  placeholder={mileage ? 'Deliver vaccine stock' : 'What it was for'}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                />
              </div>
              <div className="hr-pform__full">
                <label htmlFor="claim-receipt">Receipts / photos</label>
                <label className={receiptRequired ? 'hr-drop is-required' : 'hr-drop'} htmlFor="claim-receipt">
                  <IconDoc />
                  {receiptRequired ? 'Drop receipt, invoice or odometer photo here — required' : 'Drop receipt, invoice or odometer photo here'}
                  <input
                    id="claim-receipt"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
                  />
                </label>
                {receipt ? (
                  <div className="hr-rcpt">
                    {receiptUrl ? (
                      <img className="hr-rcpt__th" src={receiptUrl} alt="" />
                    ) : (
                      <span className="hr-rcpt__th" aria-hidden="true" />
                    )}
                    <div>
                      <span className="hr-rcpt__name">{receipt.name}</span>
                      <span className="hr-rcpt__meta">{(receipt.size / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                    <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" style={{ marginLeft: 'auto' }} onClick={() => setReceipt(null)}>
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="hr-formFoot">
              <button type="button" className="hr-btn" onClick={reset}>
                Cancel
              </button>
              <button
                type="button"
                className="hr-btn hr-btn--primary"
                onClick={send}
                disabled={!canSubmit || sending || submit.isPending}
              >
                <IconCheckCircle />
                Submit claim
              </button>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="My claims" />
          {isLoading ? null : (claims?.length ?? 0) === 0 ? (
            <PortalEmpty title="No claims yet">Photograph a receipt and send it here.</PortalEmpty>
          ) : (
            <table className="hr-table">
              <tbody>
                {claims?.map((claim) => {
                  const chip = claimChip(claim);
                  const [head, ...rest] = claim.description.split(/[:,]\s/);
                  return (
                    <tr key={claim.id}>
                      <td>
                        <b>{CATEGORY_WORD[claim.category] ?? claim.category}</b> · {rest.length ? rest.join(', ') : head}
                        <div className="hr-tdSub hr-dots">
                          Submitted {dayjs(claim.submittedAt ?? claim.createdAt).format('D MMM')}
                          {claim.distanceKm && claim.mileageRate ? ` · ${Number(claim.distanceKm)} km × RM ${Number(claim.mileageRate).toFixed(2)}` : ''}
                          {claim.attachments.map((file) =>
                            file.mimeType.startsWith('image/') ? (
                              <AuthImage key={file.id} path={myFilePath(fileIdOf(file.filePath) ?? file.id)} alt={file.fileName} className="hr-proof" />
                            ) : (
                              <span key={file.id}>
                                <IconDoc /> {file.fileName}
                              </span>
                            ),
                          )}
                        </div>
                      </td>
                      <td className="hr-num hr-strong">{rm(claim.amountApproved ?? claim.amountClaimed)}</td>
                      <td>
                        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="hr-panelHead--top">
            <PanelHead title="Medical benefit" />
          </div>
          <div className="hr-benefitNote">
            {medical ? (
              <>
                {rm(medical.used)} of {rm(medical.allowance)} used this year
                <div className="hr-bar" style={{ marginTop: 8 }}>
                  <i style={{ width: `${usedShare}%` }} />
                </div>
              </>
            ) : (
              'No medical benefit account this year.'
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
