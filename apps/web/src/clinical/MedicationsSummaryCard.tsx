import { useState } from 'react';
import { Button, Card, Empty, Modal, Space, Tag, Typography } from 'antd';
import { MedicineBoxOutlined, PlusOutlined } from '@ant-design/icons';
import { usePrescriptions } from './hooks/usePrescriptions';
import { MedicationsTab } from './MedicationsTab';
import { PrescriptionStatus } from './types';

const { Text } = Typography;

const STATUS_COLOR: Record<PrescriptionStatus, string> = {
  ORDERED: 'gold',
  DISPENSED: 'green',
  CANCELLED: 'default',
};

interface MedicationsSummaryCardProps {
  visitId: string;
}

// Canvas-mode compact card, same pattern as DiagnosisSummaryCard: list at
// a glance, "+ Add" opens the full MedicationsTab (calculator included) in
// a modal.
export function MedicationsSummaryCard({ visitId }: MedicationsSummaryCardProps) {
  const { data: prescriptions } = usePrescriptions(visitId);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        size="small"
        title="Medications"
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Add
          </Button>
        }
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        styles={{
          header: { padding: '4px 12px', minHeight: 32 },
          body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 8 },
        }}
      >
        {!prescriptions || prescriptions.length === 0 ? (
          <Empty image={<MedicineBoxOutlined style={{ fontSize: 24, opacity: 0.3 }} />} description="No medications" />
        ) : (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {prescriptions.map((prescription) => (
              <div key={prescription.id}>
                <Text>
                  {prescription.item?.name ?? 'Unknown'} — {prescription.amount}
                  {prescription.unit ?? ''} {prescription.frequency}
                </Text>
                <Tag color={STATUS_COLOR[prescription.status]} style={{ marginLeft: 6 }}>
                  {prescription.status}
                </Tag>
              </div>
            ))}
          </Space>
        )}
      </Card>
      <Modal title="Medications" open={open} onCancel={() => setOpen(false)} footer={null} width={900}>
        <MedicationsTab visitId={visitId} />
      </Modal>
    </>
  );
}
