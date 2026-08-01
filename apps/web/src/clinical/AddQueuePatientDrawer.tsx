import { useState } from 'react';
import { Button, DatePicker, Drawer, Form, Input, Radio, Select, Space, message } from 'antd';
import dayjs from 'dayjs';
import { usePatientSearch, useCreatePatient } from '../core/hooks/usePatients';
import { CreatePatientDto, Patient } from '../core/types';
import { ApiError } from '../core/api-client';
import { parseNric } from '../core/nric';
import { AddToQueueDrawer } from './AddToQueueDrawer';

interface AddQueuePatientDrawerProps {
  open: boolean;
  onClose: () => void;
}

type PickMode = 'existing' | 'new';

interface NewPatientFormValues extends Omit<CreatePatientDto, 'dob'> {
  dob?: dayjs.Dayjs;
}

// D-044 — the Queue page previously had no way to add a patient at all;
// staff had to detour through Patients list first. This combines "search
// an existing patient" and "quick-register a new one" into a single entry
// point, then hands off to the existing AddToQueueDrawer for the queue
// details once a patient is resolved.
export function AddQueuePatientDrawer({ open, onClose }: AddQueuePatientDrawerProps) {
  const [mode, setMode] = useState<PickMode>('existing');
  const [search, setSearch] = useState('');
  const [selectedExisting, setSelectedExisting] = useState<Patient>();
  const [queuingPatient, setQueuingPatient] = useState<Patient | null>(null);
  const { data: searchResults, isFetching } = usePatientSearch(search);
  const createPatient = useCreatePatient();
  const [form] = Form.useForm<NewPatientFormValues>();

  const reset = () => {
    setMode('existing');
    setSearch('');
    setSelectedExisting(undefined);
    form.resetFields();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleValuesChange = (changed: Partial<NewPatientFormValues>) => {
    if (!('identifierValue' in changed) && !('identifierType' in changed)) return;
    const values = form.getFieldsValue();
    if (values.identifierType !== 'NRIC' || !values.identifierValue) return;
    const parsed = parseNric(values.identifierValue);
    if (!parsed) return;
    const patch: Partial<NewPatientFormValues> = {};
    if (!values.dob) patch.dob = parsed.dob;
    if (!values.gender) patch.gender = parsed.gender;
    if (Object.keys(patch).length > 0) form.setFieldsValue(patch);
  };

  const handleRegisterAndContinue = async (values: NewPatientFormValues) => {
    try {
      const patient = await createPatient.mutateAsync({ ...values, dob: values.dob?.format('YYYY-MM-DD') });
      message.success('Patient registered');
      setQueuingPatient(patient);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to register patient');
    }
  };

  return (
    <>
      <Drawer title="Add Patient to Queue" open={open && !queuingPatient} onClose={handleClose} destroyOnHidden width={420}>
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          style={{ marginBottom: 16 }}
          options={[
            { label: 'Existing Patient', value: 'existing' },
            { label: 'New Patient', value: 'new' },
          ]}
        />

        {mode === 'existing' ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder="Search by name, NRIC, or phone"
              filterOption={false}
              loading={isFetching}
              value={selectedExisting?.id}
              onSearch={setSearch}
              notFoundContent={search ? 'No matching patient' : 'Type to search'}
              onChange={(value) => setSelectedExisting(searchResults?.find((p) => p.id === value))}
              options={searchResults?.map((p) => ({
                value: p.id,
                label: `${p.name} — ${p.identifierValue}${p.phone ? ` — ${p.phone}` : ''}`,
              }))}
            />
            <Button
              type="primary"
              block
              disabled={!selectedExisting}
              onClick={() => selectedExisting && setQueuingPatient(selectedExisting)}
            >
              Continue
            </Button>
          </Space>
        ) : (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleRegisterAndContinue}
            onValuesChange={handleValuesChange}
            initialValues={{ identifierType: 'NRIC' }}
          >
            <Form.Item name="name" label="Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="identifierType" label="ID Type" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'NRIC', label: 'NRIC' },
                  { value: 'PASSPORT', label: 'Passport' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="identifierValue"
              label="ID Number"
              rules={[{ required: true }]}
              tooltip="For NRIC, Date of Birth and Gender below fill in automatically."
            >
              <Input placeholder="e.g. 900101015001" />
            </Form.Item>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
            <Form.Item name="dob" label="Date of Birth">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="gender" label="Gender">
              <Input />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={createPatient.isPending} block>
              Register &amp; Continue
            </Button>
          </Form>
        )}
      </Drawer>
      <AddToQueueDrawer
        patient={queuingPatient}
        onClose={() => {
          setQueuingPatient(null);
          handleClose();
        }}
      />
    </>
  );
}
