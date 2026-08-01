import { useState } from 'react';
import { Button, DatePicker, Drawer, Form, Input, message, Popconfirm, Select, Space, Table, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { usePatients, useCreatePatient, useDeletePatient, usePatientSearch } from './hooks/usePatients';
import { CreatePatientDto, Patient } from './types';
import { ApiError } from './api-client';
import { parseNric } from './nric';
import { AddToQueueDrawer } from '../clinical/AddToQueueDrawer';

const { Title } = Typography;

interface PatientFormValues extends Omit<CreatePatientDto, 'dob'> {
  dob?: dayjs.Dayjs;
}

export function PatientsPage() {
  const [search, setSearch] = useState('');
  const { data: allPatients, isLoading } = usePatients();
  const { data: searchResults, isFetching: isSearching } = usePatientSearch(search);
  const patients = search ? searchResults : allPatients;
  const createPatient = useCreatePatient();
  const deletePatient = useDeletePatient();
  const [open, setOpen] = useState(false);
  const [queuingPatient, setQueuingPatient] = useState<Patient | null>(null);
  const [form] = Form.useForm<PatientFormValues>();

  // Auto-fills DOB/Gender from the NRIC digits as the doctor/staff types —
  // Malaysian NRIC encodes both (docs/DECISIONS.md Phase A2: manual entry
  // only for now, no physical MyKad reader hardware). Only fires while the
  // fields are still blank, so it never silently overwrites a value
  // someone already typed or corrected by hand.
  const handleValuesChange = (changed: Partial<PatientFormValues>) => {
    if (!('identifierValue' in changed) && !('identifierType' in changed)) {
      return;
    }
    const values = form.getFieldsValue();
    if (values.identifierType !== 'NRIC' || !values.identifierValue) {
      return;
    }
    const parsed = parseNric(values.identifierValue);
    if (!parsed) {
      return;
    }
    const patch: Partial<PatientFormValues> = {};
    if (!values.dob) {
      patch.dob = parsed.dob;
    }
    if (!values.gender) {
      patch.gender = parsed.gender;
    }
    if (Object.keys(patch).length > 0) {
      form.setFieldsValue(patch);
    }
  };

  const handleSubmit = async (values: PatientFormValues) => {
    try {
      await createPatient.mutateAsync({ ...values, dob: values.dob?.format('YYYY-MM-DD') });
      message.success('Patient created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create patient');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePatient.mutateAsync(id);
      message.success('Patient deleted');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to delete patient');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Patients
        </Title>
        <Space>
          <Input.Search
            allowClear
            placeholder="Search by name, NRIC, or phone"
            style={{ width: 280 }}
            loading={isSearching}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Add Patient
          </Button>
        </Space>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading || isSearching}
        dataSource={patients}
        columns={[
          {
            title: 'Name',
            dataIndex: 'name',
            render: (value: string, record) => <Link to={`/patients/${record.id}`}>{value}</Link>,
          },
          { title: 'Identifier Type', dataIndex: 'identifierType' },
          { title: 'Identifier', dataIndex: 'identifierValue' },
          { title: 'Phone', dataIndex: 'phone', render: (value: string | null) => value ?? '—' },
          { title: 'Gender', dataIndex: 'gender', render: (value: string | null) => value ?? '—' },
          {
            title: 'Actions',
            render: (_, record: Patient) => (
              <Space>
                <Button size="small" onClick={() => setQueuingPatient(record)}>
                  Add to Daily Queue
                </Button>
                <Popconfirm
                  title="Delete this patient?"
                  description="This removes them from the active list; existing visits and records are kept."
                  onConfirm={() => handleDelete(record.id)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer title="Add Patient" open={open} onClose={() => setOpen(false)} destroyOnHidden width={420}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
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
          <Form.Item name="race" label="Race">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="emergencyContactName" label="Emergency Contact Name">
            <Input />
          </Form.Item>
          <Form.Item name="emergencyContactPhone" label="Emergency Contact Phone">
            <Input />
          </Form.Item>
          <Form.Item name="allergies" label="Known Allergies">
            <Select mode="tags" open={false} placeholder="Type an allergy and press Enter" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createPatient.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
      <AddToQueueDrawer patient={queuingPatient} onClose={() => setQueuingPatient(null)} />
    </>
  );
}
