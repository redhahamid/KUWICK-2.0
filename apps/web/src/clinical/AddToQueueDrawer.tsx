import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Radio, Select, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useClinics } from '../core/hooks/useClinics';
import { useStaff } from '../hr/hooks/useStaff';
import { useAddToQueue } from './hooks/useQueueTickets';
import { usePanelClinics } from './hooks/usePanelClinics';
import { Patient } from '../core/types';
import { AddToQueueDto, QueueType } from './types';
import { ApiError } from '../core/api-client';
import { printQueueTicket } from './printQueueTicket';

// D-038 — the 4 real queue streams. Appointment arrivals get their "A"
// ticket automatically from the Appointments page, so the front-desk drawer
// offers the three manually-chosen streams (walk-in default).
const QUEUE_TYPE_OPTIONS: { label: string; value: QueueType }[] = [
  { label: 'Walk-in (W)', value: 'WALK_IN' },
  { label: 'OTC (C)', value: 'OTC' },
  { label: 'Emergency (E)', value: 'EMERGENCY' },
  { label: 'Appointment (A)', value: 'APPOINTMENT' },
];

interface AddToQueueDrawerProps {
  patient: Patient | null;
  onClose: () => void;
}

type VisitKind = 'cash' | 'panel';

// Clinical Operations, Phase A1 (Queue End-to-End) — "select panel/cash
// patient, set the limit" per the owner's flow. The panel picker replaces
// the old generic "Self-pay / Panel" text Select with the real
// PanelClinic catalog; billingType itself is still derived server-side
// from the panel's name (VisitService#create), this is just the UI.
export function AddToQueueDrawer({ patient, onClose }: AddToQueueDrawerProps) {
  const { data: clinics } = useClinics();
  const { data: staff } = useStaff();
  const { data: allPanels } = usePanelClinics();
  const panels = allPanels?.filter((panel) => panel.active);
  const addToQueue = useAddToQueue();
  const [form] = Form.useForm<Omit<AddToQueueDto, 'patientId' | 'billingType'>>();
  const [visitKind, setVisitKind] = useState<VisitKind>('cash');
  const [selectedPanelId, setSelectedPanelId] = useState<string>();
  const navigate = useNavigate();

  const selectedPanel = panels?.find((panel) => panel.id === selectedPanelId);

  const handleSubmit = async (values: Omit<AddToQueueDto, 'patientId' | 'billingType'>) => {
    if (!patient) return;
    try {
      const ticket = await addToQueue.mutateAsync({
        ...values,
        patientId: patient.id,
        billingType: visitKind === 'panel' && selectedPanel ? selectedPanel.name : 'Self-pay',
        panelClinicId: visitKind === 'panel' ? selectedPanelId : undefined,
      });
      message.success(`Added to today's queue — ${ticket.displayNumber ?? `#${ticket.ticketNumber}`}`);
      if (ticket.displayNumber) {
        const clinicName = clinics?.find((clinic) => clinic.id === values.clinicId)?.name ?? '';
        printQueueTicket(ticket.displayNumber, clinicName);
      }
      form.resetFields();
      setVisitKind('cash');
      setSelectedPanelId(undefined);
      onClose();
      navigate('/queue');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add to queue');
    }
  };

  return (
    <Drawer title={patient ? `Add ${patient.name} to Daily Queue` : 'Add to Daily Queue'} open={Boolean(patient)} onClose={onClose} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
          <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
        </Form.Item>
        <Form.Item name="staffId" label="Doctor" rules={[{ required: true }]}>
          <Select options={staff?.map((member) => ({ value: member.id, label: member.fullName }))} />
        </Form.Item>
        <Form.Item name="queueType" label="Queue Type" initialValue="WALK_IN">
          <Radio.Group optionType="button" buttonStyle="solid" options={QUEUE_TYPE_OPTIONS} />
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
          loading={addToQueue.isPending}
          disabled={visitKind === 'panel' && !selectedPanelId}
          block
        >
          Add to Queue
        </Button>
      </Form>
    </Drawer>
  );
}
