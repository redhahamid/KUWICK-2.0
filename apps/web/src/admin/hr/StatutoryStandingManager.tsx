import { useState } from 'react';
import { App, Button, DatePicker, Input, InputNumber, Modal, Select, Table } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { useRecordStatutoryClassification, useStatutoryClassifications } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import type { EmployeeRecord, StatutoryClassificationVersion } from '../types';
import { StatutoryStandingSection } from './EmployeeWorkspacePage';

/**
 * THE STANDING IS EDITABLE AT LAST — as a dated version, never as a patch.
 *
 * The readiness checklist has been telling people to "record their tax
 * residence and MTD category" while no screen could do it: the classification
 * API, its carry-forward semantics and its permission all shipped in P0, and
 * the only way to use them was to call the endpoint by hand. A blocker whose
 * remediation cannot be performed is not remediation, it is a dead end.
 *
 * TWO RULES THE FORM TEACHES rather than hides:
 *
 *   - a change is dated, and the sensible date is the FIRST DAY OF A MONTH. A
 *     classification that changes mid-period BLOCKS that month's payroll,
 *     because a contribution is worked out for a whole wage period and Kuwick
 *     will not pick which half applies;
 *   - "not recorded" is not a default. The form prefills what is in force and
 *     asks for what is not, and the engine keeps refusing to guess anything
 *     the form does not say.
 *
 * The version history under the facts is the same record the payroll run
 * resolves against, with the API's own sentence for what each version changed.
 */
export function StatutoryStandingManager({ data }: { data: EmployeeRecord }) {
  const { message } = App.useApp();
  const staffId = data.staffId;
  const mayManage = useCan('hr.employee.manage');
  const history = useStatutoryClassifications(staffId);
  const record = useRecordStatutoryClassification();
  const s = data.statutory;

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(dayjs().startOf('month'));
  const [epfMembership, setEpfMembership] = useState<string | undefined>();
  const [lindung, setLindung] = useState<string | undefined>();
  const [taxResidence, setTaxResidence] = useState<string | undefined>();
  const [pcbCategory, setPcbCategory] = useState<string | undefined>();
  // NULLABLE, deliberately. These three are MTD relief inputs, and "not
  // recorded" is not a default: initialising them to 0/false and sending them
  // unconditionally asserted "no children, not disabled" for an employee
  // whose form never said so — over-deducting tax by facts nobody entered.
  const [children, setChildren] = useState<number | null>(null);
  const [disabledSelf, setDisabledSelf] = useState<boolean | null>(null);
  const [disabledSpouse, setDisabledSpouse] = useState<boolean | null>(null);
  const [restDay, setRestDay] = useState<number | undefined>();
  const [otPolicy, setOtPolicy] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  const versions = history.data ?? [];

  const openForm = () => {
    // Prefill the standing in force so recording one change does not require
    // restating the other nine. An unresolved standing prefills nothing —
    // those fields genuinely are unanswered.
    const current = versions.find((row) => row.current);
    setFrom(dayjs().startOf('month'));
    setEpfMembership(current?.epfMembership ?? s.epfMembership ?? undefined);
    setLindung(current?.lindungParticipation ?? s.lindungParticipation ?? undefined);
    setTaxResidence(current?.taxResidence ?? s.taxResidence ?? undefined);
    setPcbCategory(current?.pcbCategory ?? s.pcbCategory ?? undefined);
    setChildren(current?.qualifyingChildren ?? s.qualifyingChildren ?? null);
    setDisabledSelf(current?.disabledSelf ?? null);
    setDisabledSpouse(current?.disabledSpouse ?? null);
    setRestDay(current?.restDayOfWeek ?? s.restDayOfWeek ?? undefined);
    setOtPolicy(current?.overtimeContractPolicy ?? s.overtimeContractPolicy ?? undefined);
    setReason('');
    setError(null);
    setOpen(true);
  };

  return (
    <>
      <StatutoryStandingSection
        data={data}
        actions={mayManage ? <Button size="small" onClick={openForm}>Record a change</Button> : undefined}
      />

      {versions.length > 0 ? (
        <AdminSection
          title="Changes to this standing"
          description="Each row is a dated version. An earlier month's payroll keeps resolving the version that was true then."
        >
          <Table<StatutoryClassificationVersion>
            rowKey="id"
            size="small"
            pagination={false}
            loading={history.isLoading}
            dataSource={versions}
            columns={[
              {
                title: 'In force',
                key: 'range',
                width: 230,
                render: (_: unknown, row) => (
                  <span>
                    {dayjs(row.effectiveFrom).format('D MMM YYYY')}
                    {' → '}
                    {row.effectiveTo ? dayjs(row.effectiveTo).format('D MMM YYYY') : <em className="kw-muted">present</em>}
                  </span>
                ),
              },
              {
                title: 'What changed',
                key: 'changed',
                render: (_: unknown, row) =>
                  row.changed.length > 0 ? (
                    row.changed.join(', ')
                  ) : (
                    <span className="kw-muted">First recorded standing</span>
                  ),
              },
              {
                title: 'Why, and who recorded it',
                key: 'provenance',
                render: (_: unknown, row) => (
                  <div>
                    <div>{row.reason ?? <span className="kw-muted">No reason given</span>}</div>
                    <div className="kw-muted" style={{ fontSize: 11.5 }}>
                      {row.recordedBy ?? 'Unknown'} · {dayjs(row.recordedAt).format('D MMM YYYY')}
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </AdminSection>
      ) : null}

      <Modal
        open={open}
        title="Record a statutory standing"
        okText="Record"
        width={620}
        confirmLoading={record.isPending}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          setError(null);
          if (!reason.trim()) {
            setError('Say why this is being recorded — a standing with no reason is not a record.');
            return;
          }
          try {
            await record.mutateAsync({
              staffId,
              effectiveFrom: from.format('YYYY-MM-DD'),
              // Only what the form knows is sent; the service carries the rest
              // of the standing forward, and stores the whole statement.
              ...(epfMembership !== undefined ? { epfMembership } : {}),
              ...(lindung !== undefined ? { lindungParticipation: lindung } : {}),
              ...(taxResidence !== undefined ? { taxResidence } : {}),
              ...(pcbCategory !== undefined ? { pcbCategory } : {}),
              // Only what the form actually says: an untouched relief field
              // is carried forward by the service, never asserted as 0/No.
              ...(children !== null ? { qualifyingChildren: children } : {}),
              ...(disabledSelf !== null ? { disabledSelf } : {}),
              ...(disabledSpouse !== null ? { disabledSpouse } : {}),
              ...(restDay !== undefined ? { restDayOfWeek: restDay } : {}),
              ...(otPolicy !== undefined ? { overtimeContractPolicy: otPolicy } : {}),
              reason: reason.trim(),
            });
            message.success('Recorded. Payroll resolves it from the date it takes effect.');
            setOpen(false);
          } catch (e) {
            // The server's refusals name consequences — "that month is already
            // approved" — and its sentence beats a generic one.
            setError(e instanceof Error ? e.message : 'The server refused the change and did not say why.');
          }
        }}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label>
            <div className="kw-fieldLabel">In force from</div>
            <DatePicker value={from} onChange={(v) => v && setFrom(v)} style={{ width: '100%' }} allowClear={false} format="D MMM YYYY" />
          </label>
          <p className="kw-muted" style={{ margin: '-4px 0 0', fontSize: 11.5 }}>
            Date it from the first day of a month. A standing that changes part-way through a month blocks that
            month&apos;s payroll, because a contribution is worked out for a whole wage period.
          </p>

          <div className="kw-formGrid2">
            <label>
              <div className="kw-fieldLabel">EPF Third Schedule Part</div>
              <Select
                value={epfMembership}
                onChange={setEpfMembership}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'MALAYSIAN_CITIZEN', label: 'Malaysian citizen' },
                  { value: 'PERMANENT_RESIDENT', label: 'Permanent resident' },
                  { value: 'NON_CITIZEN_ELECTED_PRE_1998', label: 'Non-citizen, elected before 1 Aug 1998' },
                  { value: 'NON_CITIZEN', label: 'Non-citizen' },
                ]}
              />
            </label>
            <label>
              <div className="kw-fieldLabel">LINDUNG 24 JAM</div>
              <Select
                value={lindung}
                onChange={setLindung}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'NOT_PARTICIPATING', label: 'Not participating' },
                  { value: 'VOLUNTARY_OPTED_IN', label: 'Joined voluntarily (local employee)' },
                  { value: 'MANDATORY_FOREIGN_WORKER', label: 'Mandatory — foreign worker' },
                ]}
              />
            </label>
            <label>
              <div className="kw-fieldLabel">Tax residence</div>
              <Select
                value={taxResidence}
                onChange={setTaxResidence}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'RESIDENT', label: 'Resident — progressive table' },
                  { value: 'NON_RESIDENT', label: 'Non-resident — flat 30%' },
                ]}
              />
            </label>
            <label>
              <div className="kw-fieldLabel">MTD category</div>
              <Select
                value={pcbCategory}
                onChange={setPcbCategory}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'CATEGORY_1', label: 'Category 1 — single' },
                  { value: 'CATEGORY_2', label: 'Category 2 — married, spouse not working' },
                  { value: 'CATEGORY_3', label: 'Category 3 — married, spouse working' },
                ]}
              />
            </label>
            <label>
              <div className="kw-fieldLabel">Qualifying children</div>
              <InputNumber
                min={0}
                max={20}
                value={children}
                onChange={(v) => setChildren(v)}
                placeholder="Not recorded"
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <div className="kw-fieldLabel">Rest day</div>
              <Select
                value={restDay}
                onChange={setRestDay}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (day, index) => ({ value: index, label: day }),
                )}
              />
            </label>
          </div>

          <div className="kw-formGrid2">
            <label>
              <div className="kw-fieldLabel">Disabled (self) — MTD relief</div>
              <Select
                value={disabledSelf === null ? undefined : disabledSelf ? 'YES' : 'NO'}
                onChange={(v) => setDisabledSelf(v === 'YES')}
                placeholder="Not recorded"
                style={{ width: '100%' }}
                options={[
                  { value: 'NO', label: 'No' },
                  { value: 'YES', label: 'Yes — registered disabled person' },
                ]}
              />
            </label>
            <label>
              <div className="kw-fieldLabel">Disabled spouse — MTD relief</div>
              <Select
                value={disabledSpouse === null ? undefined : disabledSpouse ? 'YES' : 'NO'}
                onChange={(v) => setDisabledSpouse(v === 'YES')}
                placeholder="Not recorded"
                style={{ width: '100%' }}
                options={[
                  { value: 'NO', label: 'No' },
                  { value: 'YES', label: 'Yes — spouse is a registered disabled person' },
                ]}
              />
            </label>
          </div>

          <label>
            <div className="kw-fieldLabel">Overtime above the Employment Act limit</div>
            <Select
              value={otPolicy}
              onChange={setOtPolicy}
              style={{ width: '100%' }}
              placeholder="Not recorded"
              options={[
                { value: 'PAY_AT_STATUTORY_RATES', label: 'Company pays overtime at the statutory rates' },
                { value: 'NOT_PAID', label: 'Overtime is not paid' },
              ]}
            />
          </label>
          <p className="kw-muted" style={{ margin: '-4px 0 0', fontSize: 11.5 }}>
            Only matters for wages above the First Schedule limit, where the Act&apos;s own overtime provisions stop
            applying. Below it, overtime is statutory and this setting is ignored.
          </p>

          <label>
            <div className="kw-fieldLabel">Reason</div>
            <Input.TextArea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded at hire, corrected after the LHDN category confirmation…"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
