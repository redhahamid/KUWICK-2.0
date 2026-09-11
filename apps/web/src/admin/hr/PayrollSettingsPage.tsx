import { Link } from 'react-router-dom';
import { App, Button, Radio, Switch } from 'antd';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import {
  usePayComponents,
  usePayrollApprovalPolicy,
  useSeedPayComponents,
  useSetPayrollApprovalPolicy,
  useStatutoryRuleSets,
} from '../hooks/useAdmin';

/**
 * PAYROLL POLICIES — one settings area, reached from the Settings landing.
 *
 * This page used to be Settings itself, and carried everything: the one-time
 * setup checklist, the company table, the approval rule, the attendance rules
 * and a list of links — about two thousand pixels presented at once to
 * somebody who came to change one thing. The checklist now opens the section
 * (see HrSettingsPage) and this is what it links to for the rules that decide
 * how a run behaves.
 *
 * Nothing here is part of paying somebody this month. It is set once and then
 * left alone, which is why Settings sits outside the six workflow sections.
 */
export function PayrollSettingsPage() {
  const { message } = App.useApp();
  const components = usePayComponents();
  const statutory = useStatutoryRuleSets();
  const seed = useSeedPayComponents();
  const approval = usePayrollApprovalPolicy();
  const setApproval = useSetPayrollApprovalPolicy();

  const componentCount = components.data?.components?.length ?? 0;
  const rateSets = statutory.data ?? [];
  const verified = rateSets.some((set) => set.verified);


  return (
    <AdminShell
      error={firstError(components, statutory, approval)}
      title="Payroll policies"
      subtitle="Who may approve a run, what counts as pay, and how attendance is judged."
      actions={
        <Link to="/admin/hr/settings">
          <Button size="small">← Settings</Button>
        </Link>
      }
    >
      {/*
        * ONE PLACE FOR THE COMPANY'S NUMBERS.
        *
        * This page carried a second listing of every legal employer, with its
        * own "can it file?" verdict and its own Open button beside each row.
        * It edited nothing, but two screens showing one fact is how they come
        * to disagree — and it is why the Settings card and the page it opened
        * ended up with different names. A signpost, not a copy.
        */}
      <p className="kw-adminSection__desc">
        The company's registration, EPF, SOCSO and LHDN numbers are on{' '}
        <Link to="/admin/hr/settings/company">Company &amp; statutory</Link>. An employer missing one of them cannot
        file, and an employer that cannot file cannot pay.
      </p>

      {/*
        * WHO IS ALLOWED TO APPROVE PAYROLL.
        *
        * Separation of duties was a hard-coded rule with an undocumented
        * exception. A group with a finance department and a single-doctor
        * clinic got the same rule and neither could see what it was.
        *
        * Three choices, written as sentences. No mode names, no "maker",
        * no "checker" — the owner is choosing how their clinic works, not
        * learning a control framework's vocabulary.
        */}
      <AdminSection
        title="Who can approve payroll"
        description="Approving a run locks it and is the moment money is committed. This is who may do it."
      >
        {approval.data ? (
          <>
            <Radio.Group
              value={approval.data.mode}
              disabled={setApproval.isPending}
              onChange={(event) =>
                setApproval.mutate(
                  { mode: event.target.value as string },
                  {
                    onSuccess: () => message.success('Approval rule updated'),
                    onError: (error: Error) => message.error(error.message),
                  },
                )
              }
            >
              <div className="kw-choiceList">
                {[
                  {
                    value: 'STANDARD',
                    title: 'Anybody who can approve payroll',
                    detail:
                      'One approval, and the person who ran the payroll may give it. Right for a clinic where one person does everything.',
                  },
                  {
                    value: 'MAKER_CHECKER',
                    title: 'Somebody other than the person who ran it',
                    detail:
                      'One approval, from a second person. Right once two people share the work and you want the figures looked at twice.',
                  },
                  {
                    value: 'DUAL_APPROVAL',
                    title: 'Two people, neither of them the one who ran it',
                    detail:
                      'The run stays open until two different people approve it. Right for a group that treats payroll as a board-level payment.',
                  },
                ].map((choice) => (
                  <label
                    key={choice.value}
                    className={`kw-choiceList__row${approval.data?.mode === choice.value ? ' kw-choiceList__row--on' : ''}`}
                  >
                    <Radio value={choice.value} />
                    <span className="kw-choiceList__body">
                      <span className="kw-choiceList__title">{choice.title}</span>
                      <span className="kw-choiceList__detail">{choice.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Radio.Group>

            {approval.data.mode === 'STANDARD' ? null : (
              <div className="kw-settingRow">
                <div className="kw-settingRow__body">
                  <div className="kw-settingRow__title">Account holders may approve their own runs</div>
                  <div className="kw-settingRow__detail">
                    A clinic with one account holder has nobody else to ask. Leave this on and they can approve their
                    own payroll; turn it off and the rule above applies to everybody, so somebody could be left unable
                    to pay anyone.
                  </div>
                </div>
                <Switch
                  checked={approval.data.allowOwnerSelfApproval}
                  loading={setApproval.isPending}
                  onChange={(checked) =>
                    setApproval.mutate(
                      { allowOwnerSelfApproval: checked },
                      {
                        onSuccess: () => message.success('Approval rule updated'),
                        onError: (error: Error) => message.error(error.message),
                      },
                    )
                  }
                />
              </div>
            )}

            {/*
              * A RULE THAT CANNOT TAKE EFFECT is worse than no rule: the clinic
              * believes two people are checking payroll and one is. Said out
              * loud rather than left for pay day.
              */}
            {approval.data.inert.length > 0 ? (
              <AdminNotice tone="warn">
                <strong>This rule will not change anything yet.</strong>
                <ul className="kw-tightList">
                  {approval.data.inert.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </AdminNotice>
            ) : null}

            <p className="kw-muted" style={{ marginTop: 12, marginBottom: 4 }}>
              {approval.data.description}
            </p>
            <p className="kw-muted" style={{ marginTop: 0, marginBottom: 8 }}>
              {approval.data.approvers.total} {approval.data.approvers.total === 1 ? 'person' : 'people'} in this clinic
              can approve payroll
              {approval.data.approvers.names.length > 0 ? `: ${approval.data.approvers.names.join(', ')}.` : '.'}
            </p>
            <ul className="kw-tightList kw-muted">
              {approval.data.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </>
        ) : null}
      </AdminSection>

      {/*
        * THE ATTENDANCE RULES ARE NOT EDITED TWICE.
        *
        * The same editable panel was rendered here AND on Attendance & leave
        * policies — one set of facts with two save buttons, which is the same
        * defect as the employer table above and a worse one, because this one
        * writes. It belongs to the card named after it.
        */}
      <p className="kw-adminSection__desc">
        The grace period before somebody is late, what counts as a full day, and leave entitlement are on{' '}
        <Link to="/admin/hr/settings/attendance-leave">Attendance &amp; leave policies</Link>. Payroll reads them; it
        does not set them.
      </p>

      <AdminSection
        title="Advanced"
        description="Detailed configuration for people who need it. Most clinics never open these after setup."
      >
        <p className="kw-muted" style={{ marginTop: 0, marginBottom: 0 }}>
          {componentCount} pay components are configured, each carrying what it counts towards — see{' '}
          <Link to="/admin/hr/settings/payroll-items">Payroll items</Link>. Opening balances, roles and permissions,
          and everything else set up once are on the <Link to="/admin/hr/settings">Settings landing</Link>.
        </p>
      </AdminSection>
    </AdminShell>
  );
}
