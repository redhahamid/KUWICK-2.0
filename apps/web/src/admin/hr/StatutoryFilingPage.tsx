import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { App, DatePicker, Input } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCan } from "../../core/hooks/useCan";
import { useRecordAgencyFiling, useStatutoryFiling } from "../hooks/useAdmin";
import type { FilingAgencyBlock, FilingMove, FilingRow } from "../types";
import {
  Drawer,
  HrPage,
  Panel,
  PanelHead,
  SegControl,
  StatCard,
  StatRow,
  StatusChip,
} from "./ui";
import { Table } from "./ui/Table";

/**
 * THE FILING HELPER — the approved month, one authority at a time.
 *
 * A person files the month in three or four sittings: KWSP, PERKESO (where
 * SOCSO, EIS and LINDUNG 24 JAM are keyed together), LHDN, and HRD Corp if
 * the clinic is registered. Each sitting needs the same three things in the
 * same order: who to add and who to remove at the portal, the list in the
 * portal's own order (name, IC, membership number, amount), and the total to
 * pay. Then it needs one more: a place to write down that it was done, with
 * the reference the portal issued. Nothing here makes a file; the figures
 * are the approved snapshot's, to the sen, and the record is a person's.
 */
const rm = (cents: number | null) =>
  cents === null
    ? "—"
    : `RM${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const SCHEME_SHORT: Record<string, string> = {
  EPF: "EPF",
  SOCSO: "SOCSO",
  EIS: "EIS",
  LINDUNG: "SKBBK",
  PCB: "PCB",
  HRD: "Levy",
};

export function StatutoryFilingPage() {
  const { id: runId = "" } = useParams();
  const filing = useStatutoryFiling(runId);
  const [agency, setAgency] = useState<string>("KWSP");
  const data = filing.data;
  const block =
    data?.agencies.find((row) => row.agency === agency) ?? data?.agencies[0];

  return (
    <HrPage
      title="Statutory filing"
      crumb={
        <>
          <Link to="/admin/hr/payroll">Payroll</Link> /{" "}
          <Link to={`/admin/hr/payroll/${runId}`}>
            {data?.periodLabel ?? "Month"}
          </Link>{" "}
          / Filing
        </>
      }
      sub={
        data
          ? `${data.periodLabel} · ${data.employerName ?? "Employer"} · approved record v${data.snapshotVersion}`
          : "The approved month, arranged for each authority’s portal."
      }
    >
      {filing.isError ? (
        <div className="hr-notice hr-notice--info">
          {filing.error instanceof Error
            ? filing.error.message
            : "The filing helper is unavailable for this month."}
        </div>
      ) : null}
      {data ? (
        <>
          <div className="hr-panelNote" style={{ padding: "0 0 12px" }}>
            {data.notASubmission}
          </div>
          <SegControl
            label="Agency"
            value={agency}
            onChange={setAgency}
            options={data.agencies.map((row) => ({
              value: row.agency,
              label: row.agency,
            }))}
          />
          {block ? (
            <AgencyView
              key={block.agency}
              runId={runId}
              block={block}
              previousMonth={data.previousMonth}
            />
          ) : null}
        </>
      ) : null}
    </HrPage>
  );
}

function AgencyView({
  runId,
  block,
  previousMonth,
}: {
  runId: string;
  block: FilingAgencyBlock;
  previousMonth: string | null;
}) {
  const canRecord = useCan("hr.payroll.approve") || useCan("hr.payroll.run");
  const [recording, setRecording] = useState(false);
  const submission = block.submission;
  const stateChip =
    submission.state === "RECORDED" ? (
      <StatusChip tone="done">
        Submitted {dayjs(submission.submittedDate).format("D MMM YYYY")}
      </StatusChip>
    ) : submission.state === "PARTIAL" ? (
      <StatusChip tone="attn">Partly recorded</StatusChip>
    ) : submission.state === "NOT_APPLICABLE" ? (
      <StatusChip tone="muted">Nothing to file</StatusChip>
    ) : (
      <StatusChip tone="attn">Not yet submitted</StatusChip>
    );

  if (!block.applicable) {
    return (
      <Panel className="hr-mt">
        <PanelHead title={block.label} sub={block.portal} actions={stateChip} />
        <div className="hr-panelNote">{block.note}</div>
      </Panel>
    );
  }

  const schemeColumns = block.schemes.flatMap((scheme) => [
    {
      title: `${SCHEME_SHORT[scheme] ?? scheme} employee`,
      num: true,
      render: (_: unknown, row: FilingRow) =>
        rm(row.parts[scheme]?.employeeCents ?? null),
    },
    {
      title: `${SCHEME_SHORT[scheme] ?? scheme} employer`,
      num: true,
      render: (_: unknown, row: FilingRow) =>
        rm(row.parts[scheme]?.employerCents ?? null),
    },
  ]);

  return (
    <>
      <StatRow>
        <StatCard
          label="Employees on the list"
          value={String(block.rows.length)}
          sub={
            block.notComputed > 0
              ? `${block.notComputed} not calculated`
              : undefined
          }
          tone={block.notComputed > 0 ? "red" : "plain"}
        />
        <StatCard label="Employee share" value={rm(block.employeeTotalCents)} />
        <StatCard label="Employer share" value={rm(block.employerTotalCents)} />
        <StatCard
          label="Total to pay"
          value={rm(block.totalCents)}
          tone="teal"
          sub={block.portal}
        />
      </StatRow>

      <Panel className="hr-mt">
        <PanelHead
          title="This month at the portal"
          sub={
            previousMonth
              ? `Compared with ${previousMonth}'s approved payroll and each person's start and last day.`
              : "From each person’s start and last day; no earlier approved month to compare with."
          }
        />
        <div className="hr-grid2">
          <MoveList
            title="Add before keying"
            people={block.joiners}
            empty="Nobody joined this month."
          />
          <MoveList
            title="Remove after filing"
            people={block.leavers}
            empty="Nobody left this month."
          />
        </div>
      </Panel>

      <Panel className="hr-mt">
        <PanelHead
          title={block.label}
          sub={`${block.portal} · in the portal's order: name, IC, membership number, amount`}
          actions={
            <>
              {stateChip}
              {submission.state === "NOT_RECORDED" && canRecord ? (
                <button
                  type="button"
                  className="hr-btn hr-btn--primary hr-btn--sm"
                  onClick={() => setRecording(true)}
                >
                  Mark as submitted
                </button>
              ) : null}
            </>
          }
        />
        {submission.state === "RECORDED" ? (
          <div className="hr-panelNote">
            Reference <strong>{submission.reference}</strong>, recorded by{" "}
            {submission.recordedBy}
            {submission.recordedAt
              ? ` on ${dayjs(submission.recordedAt).format("D MMM YYYY")}`
              : ""}
            .
          </div>
        ) : null}
        {block.notComputed > 0 ? (
          <div className="hr-notice hr-notice--block">
            {block.notComputed} employee{block.notComputed === 1 ? "’s" : "s’"}{" "}
            figure could not be worked out — see the month’s exceptions. The
            totals above are withheld until every row is calculated.
          </div>
        ) : null}
        <div style={{ overflowX: "auto" }}>
          <Table
            rows={block.rows}
            rowKey={(row) => row.staffId}
            emptyText="Nobody in the approved record."
            columns={[
              {
                title: "Name",
                render: (_: unknown, row: FilingRow) => (
                  <div>
                    {row.name}
                    {row.basisNote ? (
                      <div className="hr-muted" style={{ fontSize: 12 }}>
                        {row.basisNote}
                      </div>
                    ) : null}
                    {row.note ? (
                      <div className="hr-muted" style={{ fontSize: 12 }}>
                        {row.note}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "IC / passport",
                render: (_: unknown, row: FilingRow) =>
                  row.identifier ?? (
                    <span className="hr-muted">Not on file</span>
                  ),
              },
              {
                title: "Membership no.",
                render: (_: unknown, row: FilingRow) =>
                  row.membershipNo ?? (
                    <span className="hr-muted">Not on file</span>
                  ),
              },
              ...(block.schemes.length > 1 ? schemeColumns : []),
              {
                title: "Employee",
                num: true,
                render: (_: unknown, row: FilingRow) => rm(row.employeeCents),
              },
              {
                title: "Employer",
                num: true,
                render: (_: unknown, row: FilingRow) => rm(row.employerCents),
              },
              {
                title: "Total",
                num: true,
                render: (_: unknown, row: FilingRow) => rm(row.totalCents),
              },
            ]}
          />
        </div>
      </Panel>

      <RecordDrawer
        runId={runId}
        block={block}
        open={recording}
        onClose={() => setRecording(false)}
      />
    </>
  );
}

function MoveList({
  title,
  people,
  empty,
}: {
  title: string;
  people: FilingMove[];
  empty: string;
}) {
  return (
    <div className="hr-panelNote">
      <strong>{title}</strong>
      {people.length === 0 ? (
        <div className="hr-muted" style={{ marginTop: 4 }}>
          {empty}
        </div>
      ) : (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {people.map((person) => (
            <li key={person.staffId}>
              {person.name}
              {person.identifier ? ` · ${person.identifier}` : ""}
              {person.membershipNo ? ` · ${person.membershipNo}` : ""}
              <span className="hr-muted"> — {person.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordDrawer({
  runId,
  block,
  open,
  onClose,
}: {
  runId: string;
  block: FilingAgencyBlock;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const record = useRecordAgencyFiling(runId);
  const [date, setDate] = useState<Dayjs | null>(dayjs());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    setProblem(null);
    if (!date) return setProblem("When was it filed?");
    if (reference.trim() === "")
      return setProblem("Please enter the portal reference.");
    if (reference.trim().length < 3)
      return setProblem(
        "That portal reference looks too short. Please check it against the portal.",
      );
    record.mutate(
      {
        agency: block.agency,
        submittedDate: date.format("YYYY-MM-DD"),
        reference: reference.trim(),
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          message.success(`${block.agency} recorded as submitted.`);
          onClose();
        },
        onError: (error) =>
          setProblem(
            error instanceof Error
              ? error.message
              : "Could not record the submission.",
          ),
      },
    );
  };

  return (
    <Drawer
      open={open}
      title={`Mark ${block.agency} as submitted`}
      sub={`${block.label} · ${block.schemes.length > 1 ? `one record for ${block.schemes.map((s) => SCHEME_SHORT[s] ?? s).join(", ")}` : block.portal}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="hr-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hr-btn hr-btn--primary"
            onClick={submit}
            disabled={record.isPending}
          >
            {record.isPending ? "Recording…" : "Record submission"}
          </button>
        </>
      }
    >
      <div className="hr-fld">
        <label htmlFor="filing-date">Date filed</label>
        <DatePicker
          id="filing-date"
          value={date}
          onChange={setDate}
          format="D MMM YYYY"
          style={{ width: "100%" }}
        />
      </div>
      <div className="hr-fld">
        <label htmlFor="filing-reference">Reference from the portal</label>
        <Input
          id="filing-reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="e.g. the receipt or transaction number"
        />
      </div>
      <div className="hr-fld">
        <label htmlFor="filing-note">Note (optional)</label>
        <Input.TextArea
          id="filing-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
        />
      </div>
      {problem ? (
        <div className="hr-notice hr-notice--block">{problem}</div>
      ) : null}
      <div className="hr-panelNote">
        Recorded once per agency. The total for {block.agency} this month is{" "}
        <strong>{rm(block.totalCents)}</strong>.
      </div>
    </Drawer>
  );
}
