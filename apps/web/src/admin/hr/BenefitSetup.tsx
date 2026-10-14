import { useEffect, useState } from "react";
import { Alert, App, Input, InputNumber, Modal } from "antd";
import dayjs from "dayjs";
import { ApiError } from "../../core/api-client";
import {
  useAddBenefitUsage,
  useBenefitPolicy,
  useSaveBenefitPolicy,
  useSetUpBenefitYear,
} from "../hooks/useAdmin";

/**
 * THE MEDICAL BENEFIT, MINIMAL (Section F, 14 October 2026): the clinic's
 * yearly limit, when a joining month counts, the alert level, and one button
 * that opens the year's accounts for everybody (joiners pro-rated by whole
 * months left). Uses are entered by hand from the account drawer.
 */
export function BenefitSetupBar({
  year,
  clinicId,
}: {
  year: number;
  clinicId?: string;
}) {
  const { message } = App.useApp();
  const policy = useBenefitPolicy();
  const save = useSaveBenefitPolicy();
  const setUp = useSetUpBenefitYear();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState("");
  const [cutoff, setCutoff] = useState<number | null>(15);
  const [alertAt, setAlertAt] = useState<number>(20);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!policy.data) return;
    setLimit(
      Number(policy.data.yearlyLimit) > 0 ? policy.data.yearlyLimit : "",
    );
    setCutoff(policy.data.joiningMonthCutoffDay);
    setAlertAt(policy.data.alertBelowPercent);
  }, [policy.data]);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        yearlyLimit: limit.trim() || "0",
        joiningMonthCutoffDay: cutoff,
        alertBelowPercent: alertAt,
      });
      message.success("Benefit settings saved");
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The settings could not be saved.",
      );
    }
  };

  const openYear = async () => {
    try {
      const result = await setUp.mutateAsync({ year, clinicId });
      message.success(
        result.created === 0
          ? `Everybody already has a ${year} account.`
          : `${result.created} accounts opened for ${year}.`,
      );
    } catch (e) {
      message.error(
        e instanceof ApiError ? e.message : "The year could not be set up.",
      );
    }
  };

  const limitText =
    policy.data && Number(policy.data.yearlyLimit) > 0
      ? `RM ${Number(policy.data.yearlyLimit).toFixed(2)} a year`
      : "No yearly limit set";
  return (
    <>
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span className="hr-small hr-muted">{limitText}</span>
        <button
          type="button"
          className="hr-btn hr-btn--sm"
          onClick={() => setOpen(true)}
        >
          Benefit settings
        </button>
        <button
          type="button"
          className="hr-btn hr-btn--sm hr-btn--primary"
          onClick={() => void openYear()}
          disabled={setUp.isPending}
        >
          Open {year} accounts
        </button>
      </span>
      <Modal
        open={open}
        title="Medical benefit"
        okText="Save"
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        {error ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={error}
          />
        ) : null}
        <div className="hr-form" style={{ display: "grid", gap: 12 }}>
          <div>
            <label htmlFor="bp-limit">Yearly limit per person (RM)</label>
            <Input
              id="bp-limit"
              inputMode="decimal"
              value={limit}
              onChange={(event) =>
                setLimit(event.target.value.replace(/[^0-9.]/g, ""))
              }
            />
          </div>
          <div>
            <label htmlFor="bp-cutoff">
              A new joiner&apos;s first month counts if they join on or before
              day
            </label>
            <InputNumber
              id="bp-cutoff"
              min={1}
              max={31}
              placeholder="Never"
              value={cutoff}
              onChange={(value) => setCutoff(value ?? null)}
            />
            <div className="hr-form__help">
              A joiner gets the whole months left in the year ÷ 12 × the limit.
              Leave blank and the joining month never counts.
            </div>
          </div>
          <div>
            <label htmlFor="bp-alert">
              Warn when what is left falls to (% of the allowance)
            </label>
            <InputNumber
              id="bp-alert"
              min={0}
              max={100}
              value={alertAt}
              onChange={(value) => setAlertAt(value ?? 0)}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

/** One use entered by hand, from the account drawer. */
export function AddBenefitUsage({ accountId }: { accountId: string }) {
  const { message } = App.useApp();
  const add = useAddBenefitUsage();
  const [usedAt, setUsedAt] = useState(dayjs().format("YYYY-MM-DD"));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const send = async () => {
    try {
      await add.mutateAsync({ accountId, usedAt, amount, notes: notes.trim() });
      message.success("Use recorded");
      setAmount("");
      setNotes("");
    } catch (e) {
      message.error(
        e instanceof ApiError ? e.message : "The use could not be recorded.",
      );
    }
  };
  return (
    <div className="hr-form" style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Input
          aria-label="Date used"
          type="date"
          value={usedAt}
          onChange={(event) => setUsedAt(event.target.value)}
          style={{ width: 160 }}
        />
        <Input
          aria-label="Amount (RM)"
          inputMode="decimal"
          placeholder="RM"
          value={amount}
          onChange={(event) =>
            setAmount(event.target.value.replace(/[^0-9.]/g, ""))
          }
          style={{ width: 110 }}
        />
      </div>
      <Input
        aria-label="What it was for"
        placeholder="What it was for, e.g. clinic bill no."
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <button
        type="button"
        className="hr-btn hr-btn--sm"
        disabled={!amount || notes.trim().length < 3 || add.isPending}
        onClick={() => void send()}
      >
        Record use
      </button>
    </div>
  );
}
