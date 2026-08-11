import { Button, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { QueueBoardRow } from '../types';
import { money, queueBlockerGuidance } from '../queuePresentation';

const { Text } = Typography;

interface Props {
  row: QueueBoardRow;
  /** Rendered inline in a row's expansion, or inside the confirmation modal. */
  compact?: boolean;
}

/**
 * G4.5d3c-3b (D-095) — what is stopping this visit from closing, and who
 * fixes it.
 *
 * Every blocker names the problem, the person who resolves it and the
 * destination that resolves it. Counter staff are never handed a clinical
 * action: a pending procedure sends them to the clinical visit, it does not
 * offer them a "mark done" button.
 */
export function QueueBlockerPanel({ row, compact }: Props) {
  const navigate = useNavigate();
  const blockers = row.blockers ?? [];

  if (blockers.length === 0) {
    return (
      <Text type="secondary" role="status">
        Nothing is outstanding for this visit.
      </Text>
    );
  }

  return (
    // Announced rather than decorative: staff who cannot see the row colour
    // still learn what is outstanding.
    <div role="status" aria-live="polite">
      <Space direction="vertical" size={compact ? 6 : 10} style={{ width: '100%' }}>
        {blockers.map((blocker) => {
          const guidance = queueBlockerGuidance(blocker.code, blocker.message);
          const showAmount =
            blocker.code === 'PATIENT_BALANCE_REMAINING' && row.billing.remainingBalance !== null;
          return (
            <div key={blocker.code}>
              <Text strong>{guidance.title}</Text>
              {showAmount && (
                <Text strong> {money(row.billing.remainingBalance)} outstanding.</Text>
              )}
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {guidance.who} · {guidance.action}
                </Text>
              </div>
              {guidance.destination !== 'NONE' && (
                <Button
                  size="small"
                  type="link"
                  style={{ paddingInline: 0, minHeight: 44 }}
                  onClick={() =>
                    navigate(
                      guidance.destination === 'BILLING_REVIEW'
                        ? `/billing/visits/${row.visitId}`
                        : `/patients/${row.patientId}?visitId=${row.visitId}`,
                    )
                  }
                >
                  {guidance.destination === 'BILLING_REVIEW' ? 'Open Billing Review' : 'Open clinical visit'}
                </Button>
              )}
            </div>
          );
        })}
      </Space>
    </div>
  );
}
