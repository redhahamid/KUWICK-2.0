import { useEffect, useState } from 'react';
import { App, AutoComplete, DatePicker, Input, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  useAssignEmployer,
  useEmployees,
  useLegalEmployers,
  useRecordStatutoryClassification,
  useStatutoryClassifications,
  useUpsertEmployee,
} from '../hooks/useAdmin';
import { Drawer, ProblemNotice, useProblemFocus } from './ui';
import { PhoneField } from './ui/PhoneField';
import { ReasonPicker } from './ui/ReasonPicker';
import { EMPLOYER_REASONS, RELATIONSHIPS } from './ui/reasons';
import { NO_FIXED_DAY_HELP, REST_DAY_CHOICES, restDayBody, restDayChoiceOf, type RestDayChoice } from './restDay';
import { JobTitlePicker } from './JobTitlePicker';
import { MALAYSIAN_STATES } from './malaysianStates';
import type { EmployeeRecord } from '../types';

/**
 * EDITING THE RECORD — one drawer, opened on the section that was asked for.
 *
 * Four sections, matching the four tabs: the person (Profile), the terms
 * (Employment), the reference numbers (Statutory) and where pay goes (Bank).
 * Each posts only its own fields to the same endpoint the profile has always
 * been kept by, so nothing typed on one tab can overwrite another.
 *
 * WRITE-ONLY, BY DESIGN: the bank account number and the EPF, SOCSO and tax
 * numbers are never sent back to the screen. The form shows whether one is
 * on file and takes a replacement; it does not show the old one.
 *
 * Which statutory scheme applies, the EPF part and rate, the tax residence —
 * those are the dated standing, recorded on the Statutory tab, not here.
 *
 * THE EMPLOYING COMPANY IS THE ONE FIELD HERE THAT IS NOT PART OF THE PROFILE.
 * It has its own endpoint because it has its own rules: an archived company is
 * refused, and so is a move once the person appears on an APPROVED run —
 * their contributions were reported under the company that was on the run, and
 * changing the record afterwards would leave the submission and the record
 * disagreeing with nobody able to say which is right. So this drawer sends it
 * FIRST and separately: a refusal there leaves the rest of the record
 * untouched, rather than half-saving a change the company move then rejects.
 *
 * It was read-only until now — the record printed "Employed by" and no screen
 * in the product could set it. A payroll run refuses on NO_LEGAL_EMPLOYER and
 * that refusal is not overridable, so somebody added entirely through the
 * screens could never be paid.
 *
 * THE REST DAY IS THE SECOND SUCH FIELD, and it is here for the same reason.
 * It is part of the dated standing and it is recorded there — but the terms
 * tab is where it is PRINTED, under Working days, and payroll blocks on it.
 * The only input in the product sat behind a form that could not reach an
 * employee's first month at all, so a clinic hiring from 1 January could not
 * run January. Section 60(1) gives every employee one whole rest day a week
 * and the employer is the one who appoints it; it belongs with the terms.
 */
export type EditSection = 'profile' | 'employment' | 'statutory' | 'bank';

const TITLES: Record<EditSection, string> = {
  profile: 'Edit profile',
  employment: 'Edit employment',
  statutory: 'Edit reference numbers',
  bank: 'Edit bank account',
};

const day = (value: Dayjs | null) => (value ? value.format('YYYY-MM-DD') : undefined);
const parse = (value: string | null | undefined) => (value ? dayjs(value) : null);

export function EmployeeEditDrawer({ staffId, data, section, onClose }: { staffId: string; data: EmployeeRecord; section: EditSection | null; onClose: () => void }) {
  const { message } = App.useApp();
  const upsert = useUpsertEmployee();
  const assignEmployer = useAssignEmployer();
  const people = useEmployees({});
  const employers = useLegalEmployers();
  const standing = useStatutoryClassifications(staffId);
  const recordStanding = useRecordStatutoryClassification();
  const versions = standing.data ?? [];
  // Newest first, as the history endpoint orders them.
  const standingNow = versions.find((row) => row.current);
  const [problem, setProblem] = useState<string | null>(null);
  // The drawer body scrolls and Save sits in the pinned footer, so a banner at
  // the top of the body is invisible from where the button is. Move the view.
  useProblemFocus(problem);

  // Profile
  const [legalName, setLegalName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<Dayjs | null>(null);
  const [gender, setGender] = useState<string | undefined>();
  const [nationality, setNationality] = useState('');
  const [maritalStatus, setMaritalStatus] = useState<string | undefined>();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [ecRelation, setEcRelation] = useState('');
  // Employment
  const [employeeNo, setEmployeeNo] = useState('');
  const [position, setPosition] = useState('');
  const [jobTitleId, setJobTitleId] = useState<string | undefined>();
  const [workDays, setWorkDays] = useState<number | undefined>();
  const [department, setDepartment] = useState('');
  const [employmentType, setEmploymentType] = useState<string | undefined>();
  const [managerStaffId, setManagerStaffId] = useState<string | undefined>();
  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [confirmedDate, setConfirmedDate] = useState<Dayjs | null>(null);
  const [employerReason, setEmployerReason] = useState('');
  const [notes, setNotes] = useState('');
  const [legalEmployerId, setLegalEmployerId] = useState<string | undefined>();
  // A weekday, VARIES for an employee whose rest day is not fixed (s.59), or
  // ROSTER for one whose rest day the roster gives.
  const [restDay, setRestDay] = useState<RestDayChoice | undefined>();
  const [postcode, setPostcode] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState<string | undefined>();
  // Write-only, like the IC: typed to replace, never shown back.
  const [passport, setPassport] = useState('');
  // Statutory numbers
  const [epfNumber, setEpfNumber] = useState('');
  const [socsoNumber, setSocsoNumber] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  // Bank
  const [bankName, setBankName] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNo, setBankAccountNo] = useState('');

  useEffect(() => {
    if (!section) return;
    const id = data.identity;
    const em = data.employment;
    setLegalName(id.legalName ?? '');
    setDateOfBirth(parse(id.dateOfBirth));
    setGender(id.gender ?? undefined);
    setNationality(id.nationality ?? '');
    setMaritalStatus(id.maritalStatus ?? undefined);
    setPhone(id.phone ?? '');
    setEmail(id.email ?? '');
    setAddress(id.address ?? '');
    setPostcode(id.postcode ?? '');
    setCity(id.city ?? '');
    setState(id.state ?? undefined);
    setPassport('');
    setEcName(id.emergencyContactName ?? '');
    setEcPhone(id.emergencyContactPhone ?? '');
    setEcRelation(id.emergencyContactRelation ?? '');
    setEmployeeNo(em.employeeNo ?? '');
    setPosition(em.position ?? '');
    setJobTitleId(em.jobTitleId ?? undefined);
    setWorkDays(em.workDaysPerWeek ?? undefined);
    setDepartment(em.department ?? '');
    setEmploymentType(em.employmentType);
    setManagerStaffId(people.data?.find((row) => row.fullName === em.manager)?.staffId);
    setStartDate(parse(em.startDate));
    setConfirmedDate(parse(em.confirmedDate));
    setNotes(em.notes ?? '');
    setLegalEmployerId(em.legalEmployerId ?? undefined);
    setRestDay(restDayChoiceOf(standingNow) ?? restDayChoiceOf(data.statutory));
    setEpfNumber('');
    setSocsoNumber('');
    setTaxNumber('');
    setBankName(data.pay?.bankName ?? '');
    setBankAccountName('');
    setBankAccountNo('');
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, data]);

  /*
   * The standing comes from its own query and can still be in flight when the
   * drawer opens. Fill the field when it lands; never over a choice already
   * made.
   */
  useEffect(() => {
    if (!section || !standingNow) return;
    setRestDay((chosen) => chosen ?? restDayChoiceOf(standingNow));
  }, [section, standingNow]);

  /**
   * WHERE A REST DAY SET HERE IS WRITTEN.
   *
   * NEVER RECORDED BEFORE — it was always true and no version ever said
   * otherwise, so it is written onto every version that is silent about it.
   * Correcting only the earliest would leave a later version still silent and
   * that month still blocked, with nothing on this screen to say why.
   *
   * ALREADY RECORDED — this is a CHANGE, and a change is dated: a new version
   * from the first of this month, leaving the months already worked out with
   * the day they were worked out with.
   */
  const monthStart = dayjs().startOf('month');
  const everRecorded = versions.some((row) => row.restDayOfWeek !== null || row.restDayVaries === true);
  const changeFrom =
    versions[0] && dayjs(versions[0].effectiveFrom).isAfter(monthStart)
      ? versions[0].effectiveFrom
      : monthStart.format('YYYY-MM-DD');

  const saveRestDay = async () => {
    if (restDay === undefined) return;
    // The weekday, "it varies", or "the roster gives it": the standing carries all three.
    const chosen = restDayBody(restDay);
    if (everRecorded) {
      if (restDay === restDayChoiceOf(standingNow)) return;
      await recordStanding.mutateAsync({
        staffId,
        effectiveFrom: changeFrom,
        ...chosen,
        reason: 'Rest day changed on the employment record',
      });
      return;
    }
    const reason = 'Rest day recorded on the employment record';
    if (versions.length === 0) {
      await recordStanding.mutateAsync({
        staffId,
        effectiveFrom: day(startDate) ?? changeFrom,
        ...chosen,
        reason,
      });
      return;
    }
    for (const row of versions) {
      await recordStanding.mutateAsync({ staffId, effectiveFrom: row.effectiveFrom, ...chosen, reason });
    }
  };

  const save = async () => {
    if (!section) return;
    const blank = (value: string) => (value.trim() ? value.trim() : undefined);
    let body: Record<string, unknown> = {};
    if (section === 'profile') {
      body = {
        legalName: blank(legalName),
        dateOfBirth: day(dateOfBirth),
        gender,
        nationality: blank(nationality),
        maritalStatus,
        phone: blank(phone),
        email: blank(email),
        address: blank(address),
        postcode: blank(postcode),
        city: blank(city),
        state: state ?? undefined,
        passportNumber: blank(passport),
        emergencyContactName: blank(ecName),
        emergencyContactPhone: blank(ecPhone),
        emergencyContactRelation: blank(ecRelation),
      };
    } else if (section === 'employment') {
      if (!startDate) {
        setProblem('The start date is the one fact every other date is measured from.');
        return;
      }
      body = {
        employeeNo: blank(employeeNo),
        position: blank(position),
        jobTitleId,
        workDaysPerWeek: workDays,
        department: blank(department),
        employmentType,
        managerStaffId,
        startDate: day(startDate),
        confirmedDate: day(confirmedDate),
        notes: blank(notes),
      };
    } else if (section === 'statutory') {
      body = { epfNumber: blank(epfNumber), socsoNumber: blank(socsoNumber), taxNumber: blank(taxNumber) };
      if (Object.values(body).every((value) => value === undefined)) {
        setProblem('Enter the number that is changing. Blank fields leave what is on file as it is.');
        return;
      }
    } else {
      body = { bankName: blank(bankName), bankAccountName: blank(bankAccountName), bankAccountNo: blank(bankAccountNo) };
      if (!body.bankName && !body.bankAccountNo) {
        setProblem('Enter the bank and the account number.');
        return;
      }
    }
    try {
      /*
       * THE COMPANY MOVE GOES FIRST, and only when it changed. It is the one
       * thing here the server can refuse outright — an archived company, or a
       * person already on an approved run — and a refusal has to leave the
       * record as it was rather than half-written.
       */
      if (section === 'employment' && (legalEmployerId ?? null) !== (data.employment.legalEmployerId ?? null)) {
        await assignEmployer.mutateAsync({ staffId, legalEmployerId: legalEmployerId ?? null, reason: employerReason.trim() || undefined });
      }
      await upsert.mutateAsync({ staffId, ...body });
      if (section === 'employment') {
        // The record is written by now. A refusal here — a month already
        // approved with a different day in it — is about the rest day alone,
        // and has to say so rather than read as the whole save failing.
        try {
          await saveRestDay();
        } catch (error) {
          const why = error instanceof Error ? error.message : 'the server did not say why.';
          setProblem(`The employment record is saved, but the rest day was refused: ${why}`);
          return;
        }
      }
      message.success('Saved.');
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The server refused the change and did not say why.');
    }
  };

  const managers = (people.data ?? []).filter((row) => row.staffId !== staffId && row.hasProfile);
  /*
   * SAY WHICH DATE THIS LANDS ON, before it lands on it. The rest day is part
   * of a dated standing, so setting it here has to state the date it is being
   * set from — otherwise the screen is making a dating decision on the
   * clinic's behalf and not telling them.
   */
  const restDayNote = (() => {
    if (versions.length === 0) {
      return `Recorded from ${startDate ? startDate.format('D MMM YYYY') : 'their start date'}, where their statutory standing will start.`;
    }
    if (!everRecorded) {
      const first = dayjs(versions[versions.length - 1].effectiveFrom).format('D MMM YYYY');
      return versions.length === 1
        ? `Recorded from ${first}, where their standing starts, so their first month has one.`
        : `Recorded from ${first} onwards, across all ${versions.length} versions of their standing, because none of them records one.`;
    }
    return `A change takes effect from ${dayjs(changeFrom).format('D MMM YYYY')}. Earlier months keep the day they were worked out with.`;
  })();
  /*
   * ACTIVE COMPANIES, PLUS THE ONE THEY ARE ALREADY ON. An archived company
   * is refused by the server, so offering it would be offering a dead end —
   * but a person sitting on one must still see where they are, or the box
   * reads empty and the screen looks like it lost the fact.
   */
  const employerOptions = (employers.data ?? [])
    .filter((row) => row.active || row.id === data.employment.legalEmployerId)
    .map((row) => ({
      value: row.id,
      label: row.active ? row.name : `${row.name} (archived)`,
    }));

  return (
    <Drawer
      open={section !== null}
      onClose={onClose}
      title={section ? TITLES[section] : ''}
      sub={
        section === 'statutory' || section === 'bank'
          ? 'Numbers on file are never shown back. Type a replacement to change one; leave a field blank to keep it.'
          : data.identity.fullName
      }
      footer={
        <>
          <button type="button" className="hr-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hr-btn hr-btn--primary"
            onClick={() => void save()}
            disabled={upsert.isPending || assignEmployer.isPending}
          >
            Save
          </button>
        </>
      }
    >
      <div className="hr-form">
        {section === 'profile' ? (
          <>
            <div>
              <label htmlFor="ed-legal">Legal name</label>
              <Input id="ed-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="As on the IC or passport" />
            </div>
            <div className="hr-form__row">
              <div>
                <label htmlFor="ed-dob">Date of birth</label>
                <DatePicker id="ed-dob" value={dateOfBirth} onChange={setDateOfBirth} format="D MMM YYYY" style={{ width: '100%' }} />
              </div>
              <div>
                <label htmlFor="ed-gender">Gender</label>
                <Select
                  id="ed-gender"
                  value={gender}
                  onChange={setGender}
                  allowClear
                  placeholder="Not recorded"
                  style={{ width: '100%' }}
                  options={[
                    { value: 'MALE', label: 'Male' },
                    { value: 'FEMALE', label: 'Female' },
                  ]}
                />
              </div>
              <div>
                <label htmlFor="ed-nat">Nationality</label>
                <Input id="ed-nat" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. Malaysian" />
              </div>
              <div>
                <label htmlFor="ed-marital">Marital status</label>
                <Select
                  id="ed-marital"
                  value={maritalStatus}
                  onChange={setMaritalStatus}
                  allowClear
                  placeholder="Not recorded"
                  style={{ width: '100%' }}
                  options={[
                    { value: 'SINGLE', label: 'Single' },
                    { value: 'MARRIED', label: 'Married' },
                    { value: 'DIVORCED', label: 'Divorced' },
                    { value: 'WIDOWED', label: 'Widowed' },
                  ]}
                />
              </div>
              <div>
                <label htmlFor="ed-phone">Phone</label>
                <PhoneField id="ed-phone" value={phone} onChange={setPhone} />
              </div>
              <div>
                <label htmlFor="ed-email">Email</label>
                <Input id="ed-email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="ed-address">Street address</label>
              <Input id="ed-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12, Jalan Bangi Avenue 3" />
            </div>
            <div className="hr-form__row">
              <div>
                <label htmlFor="ed-postcode">Postcode</label>
                <Input id="ed-postcode" inputMode="numeric" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="e.g. 43650" />
              </div>
              <div>
                <label htmlFor="ed-city">City or town</label>
                <Input id="ed-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bandar Baru Bangi" />
              </div>
              <div>
                <label htmlFor="ed-state">State</label>
                <Select id="ed-state" value={state} onChange={setState} allowClear showSearch placeholder="Choose" style={{ width: '100%' }} options={MALAYSIAN_STATES.map((name) => ({ value: name, label: name }))} />
              </div>
              <div>
                <label htmlFor="ed-passport">Passport number</label>
                <Input id="ed-passport" value={passport} onChange={(e) => setPassport(e.target.value)} placeholder={data.identity.passportOnFile ? 'On file — type to replace' : 'Not recorded'} />
              </div>
            </div>
            <div className="hr-form__group">Emergency contact</div>
            <div className="hr-form__row">
              <div>
                <label htmlFor="ed-ecn">Name</label>
                <Input id="ed-ecn" value={ecName} onChange={(e) => setEcName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ed-ecp">Phone</label>
                <PhoneField id="ed-ecp" value={ecPhone} onChange={setEcPhone} />
              </div>
              <div>
                <label htmlFor="ed-ecr">Relationship</label>
                <AutoComplete id="ed-ecr" value={ecRelation} onChange={(next) => setEcRelation(String(next ?? ''))} options={RELATIONSHIPS.map((value) => ({ value }))} placeholder="Choose or type" style={{ width: '100%' }} />
              </div>
            </div>
          </>
        ) : null}

        {section === 'employment' ? (
          <>
            <div className="hr-form__row">
              <div>
                <label htmlFor="ed-no">Employee number</label>
                <Input id="ed-no" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ed-type">Type</label>
                <Select
                  id="ed-type"
                  value={employmentType}
                  onChange={setEmploymentType}
                  style={{ width: '100%' }}
                  options={[
                    { value: 'PERMANENT', label: 'Permanent' },
                    { value: 'CONTRACT', label: 'Contract' },
                    { value: 'PART_TIME', label: 'Part-time' },
                    { value: 'LOCUM', label: 'Locum' },
                    { value: 'INTERN', label: 'Intern' },
                  ]}
                />
              </div>
              <div>
                <label htmlFor="ed-pos">Job title</label>
                <JobTitlePicker
                  id="ed-pos"
                  value={jobTitleId}
                  onChange={(id, name) => {
                    setJobTitleId(id);
                    setPosition(name ?? '');
                  }}
                />
              </div>
              <div>
                <label htmlFor="ed-days">Days a week</label>
                <Select
                  id="ed-days"
                  value={workDays}
                  onChange={setWorkDays}
                  allowClear
                  placeholder="Not recorded"
                  style={{ width: '100%' }}
                  options={[
                    { value: 5, label: '5 days' },
                    { value: 5.5, label: '5½ days' },
                    { value: 6, label: '6 days' },
                  ]}
                />
              </div>
              <div>
                <label htmlFor="ed-dept">Department</label>
                <Input id="ed-dept" value={department} onChange={(e) => setDepartment(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ed-start">Joined</label>
                <DatePicker id="ed-start" value={startDate} onChange={setStartDate} format="D MMM YYYY" style={{ width: '100%' }} />
              </div>
              <div>
                <label htmlFor="ed-conf">Confirmed</label>
                <DatePicker id="ed-conf" value={confirmedDate} onChange={setConfirmedDate} format="D MMM YYYY" style={{ width: '100%' }} />
              </div>
            </div>
            <div>
              <label htmlFor="ed-employer">Employed by</label>
              <Select
                id="ed-employer"
                value={legalEmployerId}
                onChange={setLegalEmployerId}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={employerOptions.length > 0 ? 'Not recorded' : 'No company is on file yet'}
                style={{ width: '100%' }}
                options={employerOptions}
                notFoundContent="No company on file. Add one in Settings, Company and statutory."
              />
              {(legalEmployerId ?? null) !== (data.employment.legalEmployerId ?? null) ? (
                <div style={{ marginTop: 8 }}>
                  <label htmlFor="ed-employer-reason">Why the company is changing</label>
                  <ReasonPicker id="ed-employer-reason" value={employerReason} onChange={setEmployerReason} options={EMPLOYER_REASONS} />
                </div>
              ) : null}
              <div className="hr-form__help">
                The company that pays them and files their EPF, SOCSO and tax. Payroll refuses to work out a month for
                anybody without one, and that refusal cannot be passed. A branch is where they work; it files nothing.
              </div>
            </div>
            <div>
              <label htmlFor="ed-rest">Rest day</label>
              <Select
                id="ed-rest"
                value={restDay}
                onChange={setRestDay}
                placeholder="Not recorded"
                style={{ width: '100%' }}
                options={REST_DAY_CHOICES}
              />
              <div className="hr-form__help">
                {restDayNote} Section 60(1) gives one whole day a week and the employer appoints it. Payroll refuses to
                work out a month without it, and that refusal cannot be passed. Where it varies week to week or rotates
                with the roster, say so: the month runs, and the run says rest-day pay for them is keyed by hand.
                {restDay === 'VARIES' || restDay === 'ROSTER' ? ` ${NO_FIXED_DAY_HELP}` : ''}
              </div>
            </div>
            <div>
              <label htmlFor="ed-mgr">Reports to</label>
              <Select
                id="ed-mgr"
                value={managerStaffId}
                onChange={setManagerStaffId}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Nobody recorded"
                style={{ width: '100%' }}
                options={managers.map((row) => ({ value: row.staffId, label: row.fullName }))}
              />
            </div>
            <div>
              <label htmlFor="ed-notes">Notes</label>
              <Input.TextArea id="ed-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="hr-form__help">The branch a person works at is set on their account.</div>
          </>
        ) : null}

        {section === 'statutory' ? (
          <>
            <div>
              <label htmlFor="ed-epf">EPF / KWSP number</label>
              <Input id="ed-epf" value={epfNumber} onChange={(e) => setEpfNumber(e.target.value)} placeholder={data.statutory.epfNumberOnFile ? 'On file — type to replace' : 'Not on file'} />
            </div>
            <div>
              <label htmlFor="ed-socso">SOCSO / PERKESO number</label>
              <Input id="ed-socso" value={socsoNumber} onChange={(e) => setSocsoNumber(e.target.value)} placeholder={data.statutory.socsoNumberOnFile ? 'On file — type to replace' : 'Not on file'} />
            </div>
            <div>
              <label htmlFor="ed-tax">Income tax number</label>
              <Input id="ed-tax" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} placeholder={data.statutory.taxNumberOnFile ? 'On file — type to replace' : 'Not on file'} />
            </div>
          </>
        ) : null}

        {section === 'bank' ? (
          <>
            <div>
              <label htmlFor="ed-bank">Bank</label>
              <Input id="ed-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Maybank, CIMB, Public Bank…" />
            </div>
            <div>
              <label htmlFor="ed-acctname">Account name</label>
              <Input id="ed-acctname" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} placeholder="As the bank has it" />
            </div>
            <div>
              <label htmlFor="ed-acct">Account number</label>
              <Input id="ed-acct" value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value)} inputMode="numeric" placeholder={data.pay?.bankAccountOnFile ? 'On file — type to replace' : 'Not on file'} />
              <div className="hr-form__help">Changing where somebody's pay goes needs payroll access as well as record access; the server refuses it otherwise.</div>
            </div>
          </>
        ) : null}

        <ProblemNotice problem={problem} />
      </div>
    </Drawer>
  );
}
