import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Radio, Select, Space, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useClinics } from '../core/hooks/useClinics';
import { useDefaultClinicId } from '../core/hooks/useClinicFilter';
import { useStaff } from '../hr/hooks/useStaff';
import { useAddToQueue } from './hooks/useQueueTickets';
import { usePanelClinics, useUpdatePanelClinic } from './hooks/usePanelClinics';
import { useCounterPrefill, useCreatePanelEmployer, usePanelEmployers } from './hooks/usePanelEmployers';
import { Patient } from '../core/types';
import { AddToQueueDto, PANEL_RELATIONSHIP_LABEL, PanelRelationship, QueueType } from './types';
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

/** N-5 — who the patient is to the person covered, in a clinic's own words. */
const RELATIONSHIP_OPTIONS = (
  ['SELF', 'SPOUSE', 'CHILD', 'PARENT', 'OTHER'] as PanelRelationship[]
).map((value) => ({ value, label: PANEL_RELATIONSHIP_LABEL[value] }));

// Clinical Operations, Phase A1 (Queue End-to-End) — "select panel/cash
// patient, set the limit" per the owner's flow. The panel picker replaces
// the old generic "Self-pay / Panel" text Select with the real
// PanelClinic catalog; billingType itself is still derived server-side
// from the panel's name (VisitService#create), this is just the UI.
export function AddToQueueDrawer({ patient, onClose }: AddToQueueDrawerProps) {
  return (
    <Drawer
      title={patient ? `Add ${patient.name} to Daily Queue` : 'Add to Daily Queue'}
      open={Boolean(patient)}
      onClose={onClose}
      destroyOnHidden
    >
      {patient && <QueueDetailsForm patient={patient} onClose={onClose} />}
    </Drawer>
  );
}

/**
 * The drawer body — a child on purpose (A1): `Form.useForm` and its `<Form>`
 * mount and unmount together with the drawer's content (destroyOnHidden), so
 * the instance is never left connected to nothing, and each open starts from
 * clean fields.
 */
function QueueDetailsForm({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const { data: clinics } = useClinics();
  const { data: staff } = useStaff();
  const { data: allPanels } = usePanelClinics();
  const panels = allPanels?.filter((panel) => panel.active);
  const defaultClinicId = useDefaultClinicId();
  const addToQueue = useAddToQueue();
  const updatePanelClinic = useUpdatePanelClinic();
  const [form] = Form.useForm<Omit<AddToQueueDto, 'patientId' | 'billingType'>>();
  const [visitKind, setVisitKind] = useState<VisitKind>('cash');
  const [selectedPanelId, setSelectedPanelId] = useState<string>();
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState<number | null>(null);
  const navigate = useNavigate();

  // N-5 — the employer behind the panel, who the patient is to the member, and
  // the card number. All three were re-typed at every visit before this.
  const [employerId, setEmployerId] = useState<string>();
  const [relationship, setRelationship] = useState<PanelRelationship>();
  const [memberReference, setMemberReference] = useState('');
  const [newEmployer, setNewEmployer] = useState('');
  const employers = usePanelEmployers(selectedPanelId);
  const createEmployer = useCreatePanelEmployer();

  const selectedPanel = panels?.find((panel) => panel.id === selectedPanelId);

  /*
   * N-5 — WHAT THIS PATIENT CAME IN ON LAST, filled in once.
   *
   * Kuwick 1.0 did this and 2.0 did not: the card, the employer and the
   * relationship were keyed again at every visit, at the counter, from a card
   * the patient has to find in their wallet.
   *
   * A SUGGESTION, NEVER A COMMITMENT. It fills the form and nothing else — the
   * visit still starts PENDING_VERIFICATION and staff still press Verify, so a
   * panel that has lapsed is caught by the same step that catches one typed
   * wrongly by hand.
   *
   * Applied ONCE, guarded by `prefilled`. Re-applying on every render would
   * fight the person: clearing the employer, or switching to Cash because this
   * visit is self-pay, would be undone under their cursor.
   *
   * A remembered panel that has since been TURNED OFF is not pre-selected —
   * the picker does not offer it — but the notice below still names it, so the
   * screen says why the form is empty instead of implying the patient was
   * always self-pay.
   */
  const prefill = useCounterPrefill(patient.id);
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    const remembered = prefill.data;
    if (prefilled || !remembered) return;
    setPrefilled(true);
    if (!remembered.autoSelectLastPanel) return;
    if (!remembered.panelClinicId || remembered.panelActive === false) return;
    setVisitKind('panel');
    setSelectedPanelId(remembered.panelClinicId);
    if (remembered.employerId && remembered.employerActive !== false) {
      setEmployerId(remembered.employerId);
    }
    setRelationship(remembered.relationship ?? undefined);
    setMemberReference(remembered.memberReference ?? '');
  }, [prefill.data, prefilled]);

  /** The employer belongs to a panel, so changing the panel clears it. */
  const choosePanel = (panelId: string) => {
    setSelectedPanelId(panelId);
    if (panelId !== selectedPanelId) setEmployerId(undefined);
  };

  const addEmployer = async () => {
    const name = newEmployer.trim();
    if (!name || !selectedPanelId) return;
    try {
      const created = await createEmployer.mutateAsync({ panelClinicId: selectedPanelId, name });
      setEmployerId(created.id);
      setNewEmployer('');
      message.success(`${created.name} added to ${selectedPanel?.name ?? 'this panel'}`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not add that employer');
    }
  };

  // D-044 — panel limits are renegotiated often ("can change from time to
  // time"); staff shouldn't have to leave the queue-add flow and hunt down
  // Panel Clinics just to bump a number.
  const startEditLimit = () => {
    setLimitDraft(selectedPanel?.limitAmount ? Number(selectedPanel.limitAmount) : null);
    setEditingLimit(true);
  };

  const saveLimit = async () => {
    if (!selectedPanelId) return;
    try {
      await updatePanelClinic.mutateAsync({ id: selectedPanelId, dto: { limitAmount: limitDraft ?? undefined } });
      message.success('Panel limit updated');
      setEditingLimit(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to update panel limit');
    }
  };

  const handleSubmit = async (values: Omit<AddToQueueDto, 'patientId' | 'billingType'>) => {
    try {
      const ticket = await addToQueue.mutateAsync({
        ...values,
        patientId: patient.id,
        billingType: visitKind === 'panel' && selectedPanel ? selectedPanel.name : 'Self-pay',
        panelClinicId: visitKind === 'panel' ? selectedPanelId : undefined,
        // Sent only for a panel visit. A self-pay visit carrying an employer
        // would be refused by the server, which checks the pair (N-5).
        panelEmployerId: visitKind === 'panel' ? employerId : undefined,
        panelRelationship: visitKind === 'panel' ? relationship : undefined,
        panelMemberReference:
          visitKind === 'panel' ? memberReference.trim() || undefined : undefined,
      });
      message.success(`Added to today's queue — ${ticket.displayNumber ?? `#${ticket.ticketNumber}`}`);
      if (ticket.displayNumber) {
        const clinicName = clinics?.find((clinic) => clinic.id === values.clinicId)?.name ?? '';
        printQueueTicket(ticket.displayNumber, clinicName);
      }
      form.resetFields();
      setVisitKind('cash');
      setSelectedPanelId(undefined);
      setEmployerId(undefined);
      setRelationship(undefined);
      setMemberReference('');
      onClose();
      navigate('/queue');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add to queue');
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
      <Form.Item name="queueType" label="Queue Type" initialValue="WALK_IN">
        <Radio.Group optionType="button" buttonStyle="solid" options={QUEUE_TYPE_OPTIONS} />
      </Form.Item>
      {/* N-5 — the screen says why the form is empty, rather than letting
          somebody conclude the patient was always self-pay. */}
      {prefill.data?.panelClinicId && prefill.data.panelActive === false ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message={`This patient last came in on ${prefill.data.panelName}, which is switched off. Choose another panel, or turn it back on in Panel configuration.`}
        />
      ) : null}
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
            aria-label="Which panel"
            value={selectedPanelId}
            onChange={choosePanel}
            options={panels?.map((panel) => ({ value: panel.id, label: panel.name }))}
          />
          {selectedPanel && !editingLimit && (
            <Alert
              style={{ marginTop: 8 }}
              type="info"
              showIcon
              message={
                <Space>
                  {selectedPanel.limitAmount
                    ? `Panel limit: RM ${selectedPanel.limitAmount} per visit`
                    : 'No limit configured for this panel'}
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={startEditLimit}>
                    Edit
                  </Button>
                </Space>
              }
            />
          )}
          {selectedPanel && editingLimit && (
            <Space style={{ marginTop: 8 }}>
              <InputNumber
                autoFocus
                min={0}
                prefix="RM"
                placeholder="No limit"
                value={limitDraft}
                onChange={setLimitDraft}
              />
              <Button type="primary" size="small" loading={updatePanelClinic.isPending} onClick={saveLimit}>
                Save
              </Button>
              <Button size="small" onClick={() => setEditingLimit(false)}>
                Cancel
              </Button>
            </Space>
          )}
        </Form.Item>
      )}
      {visitKind === 'panel' && selectedPanelId && (
        <>
          <Form.Item label="Employer" help="Who the patient works for, where the panel runs a company scheme.">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              aria-label="Employer"
              placeholder={
                employers.isLoading ? 'Loading…' : 'Not recorded — choose or add below'
              }
              value={employerId}
              onChange={(value) => setEmployerId(value)}
              options={employers.data?.map((employer) => ({
                value: employer.id,
                label: employer.name,
              }))}
            />
            {/* QUICK-ADD, per the owner's answer: a company nobody has entered
                yet must not stop a registration. It adds the NAME only — the
                payment term is a contract fact somebody looks up later, and an
                employer without one takes the panel's. */}
            <Space.Compact style={{ marginTop: 8, width: '100%' }}>
              <Input
                placeholder="Or add a new employer"
                value={newEmployer}
                onChange={(event) => setNewEmployer(event.target.value)}
                onPressEnter={(event) => {
                  // Enter in this box must not submit the whole drawer.
                  event.preventDefault();
                  void addEmployer();
                }}
              />
              <Button
                onClick={addEmployer}
                loading={createEmployer.isPending}
                disabled={!newEmployer.trim()}
              >
                Add
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label="Who is covered?">
            <Select
              allowClear
              aria-label="Who is covered?"
              placeholder="Not recorded"
              value={relationship}
              onChange={(value) => setRelationship(value)}
              options={RELATIONSHIP_OPTIONS}
            />
          </Form.Item>
          <Form.Item label="Card or membership number">
            <Input
              aria-label="Card or membership number"
              placeholder="As printed on the patient's card"
              value={memberReference}
              onChange={(event) => setMemberReference(event.target.value)}
            />
          </Form.Item>
        </>
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
  );
}
