import { useEffect, useState } from 'react';
import { App, DatePicker, Input, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEmployees, useUpsertEmployee } from '../hooks/useAdmin';
import { Drawer, ProblemNotice, useProblemFocus } from './ui';
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
  const people = useEmployees({});
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
  const [department, setDepartment] = useState('');
  const [employmentType, setEmploymentType] = useState<string | undefined>();
  const [managerStaffId, setManagerStaffId] = useState<string | undefined>();
  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [confirmedDate, setConfirmedDate] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState('');
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
    setEcName(id.emergencyContactName ?? '');
    setEcPhone(id.emergencyContactPhone ?? '');
    setEcRelation(id.emergencyContactRelation ?? '');
    setEmployeeNo(em.employeeNo ?? '');
    setPosition(em.position ?? '');
    setDepartment(em.department ?? '');
    setEmploymentType(em.employmentType);
    setManagerStaffId(people.data?.find((row) => row.fullName === em.manager)?.staffId);
    setStartDate(parse(em.startDate));
    setConfirmedDate(parse(em.confirmedDate));
    setNotes(em.notes ?? '');
    setEpfNumber('');
    setSocsoNumber('');
    setTaxNumber('');
    setBankName(data.pay?.bankName ?? '');
    setBankAccountName('');
    setBankAccountNo('');
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, data]);

  const save = () => {
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
    upsert.mutate(
      { staffId, ...body },
      {
        onSuccess: () => {
          message.success('Saved.');
          onClose();
        },
        onError: (error: Error) => setProblem(error.message),
      },
    );
  };

  const managers = (people.data ?? []).filter((row) => row.staffId !== staffId && row.hasProfile);

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
          <button type="button" className="hr-btn hr-btn--primary" onClick={save} disabled={upsert.isPending}>
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
                <Input id="ed-nat" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Malaysian" />
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
                <Input id="ed-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ed-email">Email</label>
                <Input id="ed-email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="ed-address">Address</label>
              <Input.TextArea id="ed-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="hr-form__group">Emergency contact</div>
            <div className="hr-form__row">
              <div>
                <label htmlFor="ed-ecn">Name</label>
                <Input id="ed-ecn" value={ecName} onChange={(e) => setEcName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ed-ecp">Phone</label>
                <Input id="ed-ecp" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ed-ecr">Relationship</label>
                <Input id="ed-ecr" value={ecRelation} onChange={(e) => setEcRelation(e.target.value)} placeholder="Spouse, parent, sibling…" />
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
                <label htmlFor="ed-pos">Position</label>
                <Input id="ed-pos" value={position} onChange={(e) => setPosition(e.target.value)} />
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
            <div className="hr-form__help">The branch a person works at and the company that employs them are set on their account and on Company &amp; statutory.</div>
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
