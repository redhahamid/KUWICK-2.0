import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Radio, Select, message } from 'antd';
import { useClinics } from '../core/hooks/useClinics';
import { useDefaultClinicId } from '../core/hooks/useClinicFilter';
import { useStaff } from '../hr/hooks/useStaff';
import { usePanelClinics } from './hooks/usePanelClinics';
import { useCreateVisit } from './hooks/useVisits';
import { Patient } from '../core/types';
import { CreateVisitDto } from './types';
import { ApiError } from '../core/api-client';

interface NewVisitDrawerProps {
  patient: Patient;
  open: boolean;
  onClose: () => void;
  onCreated: (visitId: string) => void;
}

type VisitKind = 'cash' | 'panel';

// D-044 — a Patient Dashboard could only show existing visits; there was
// no way to start a new medical record without detouring through the
// Queue. This creates a Visit directly (no queue ticket), for a doctor-
// initiated follow-up or any consult that doesn't need front-desk queuing.
export function NewVisitDrawer({ patient, open, onClose, onCreated }: NewVisitDrawerProps) {
  return (
    <Drawer title={`New Visit — ${patient.name}`} open={open} onClose={onClose} destroyOnHidden>
      <NewVisitForm patient={patient} onClose={onClose} onCreated={onCreated} />
    </Drawer>
  );
}

/**
 * The drawer body — a child on purpose (A1): `Form.useForm` and its `<Form>`
 * mount and unmount together with the drawer's content (destroyOnHidden), so
 * the instance is never left connected to nothing, and each open starts from
 * clean fields without a manual reset.
 */
function NewVisitForm({
  patient,
  onClose,
  onCreated,
}: {
  patient: Patient;
  onClose: () => void;
  onCreated: (visitId: string) => void;
}) {
  const { data: clinics } = useClinics();
  const { data: staff } = useStaff();
  const { data: allPanels } = usePanelClinics();
  const panels = allPanels?.filter((panel) => panel.active);
  const defaultClinicId = useDefaultClinicId();
  const createVisit = useCreateVisit();
  const [form] = Form.useForm<Omit<CreateVisitDto, 'patientId' | 'billingType'>>();
  const [visitKind, setVisitKind] = useState<VisitKind>('cash');
  const [selectedPanelId, setSelectedPanelId] = useState<string>();

  const selectedPanel = panels?.find((panel) => panel.id === selectedPanelId);

  const handleSubmit = async (values: Omit<CreateVisitDto, 'patientId' | 'billingType'>) => {
    try {
      const visit = await createVisit.mutateAsync({
        ...values,
        patientId: patient.id,
        billingType: visitKind === 'panel' && selectedPanel ? selectedPanel.name : 'Self-pay',
        panelClinicId: visitKind === 'panel' ? selectedPanelId : undefined,
      });
      message.success(`New visit created — ${visit.visitNumber}`);
      onCreated(visit.id);
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create visit');
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ clinicId: defaultClinicId }}>
      <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
        <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
      </Form.Item>
      <Form.Item name="staffId" label="Doctor" rules={[{ required: true }]}>
        <Select options={staff?.map((member) => ({ value: member.id, label: member.fullName }))} />
      </Form.Item>
      <Form.Item label="Billing Type" required>
        <Radio.Group
          value={visitKind}
          onChange={(e) => setVisitKind(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: 'Cash', value: 'cash' },
            { label: 'Panel', value: 'panel' },
          ]}
        />
      </Form.Item>
      {visitKind === 'panel' && (
        <Form.Item label="Panel" required>
          <Select
            placeholder="Select panel..."
            value={selectedPanelId}
            onChange={setSelectedPanelId}
            options={panels?.map((panel) => ({ value: panel.id, label: panel.name }))}
          />
          {selectedPanel && (
            <Alert
              style={{ marginTop: 8 }}
              type="info"
              showIcon
              message={
                selectedPanel.limitAmount
                  ? `Panel limit: RM ${selectedPanel.limitAmount} per visit`
                  : 'No limit configured for this panel'
              }
            />
          )}
        </Form.Item>
      )}
      <Form.Item name="presentingComplaint" label="Presenting Complaint">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Button
        type="primary"
        htmlType="submit"
        loading={createVisit.isPending}
        disabled={visitKind === 'panel' && !selectedPanelId}
        block
      >
        Create Visit
      </Button>
    </Form>
  );
}
