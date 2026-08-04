import { Alert, Card, List, Space, Typography } from 'antd';
import { BillingWorklistItem, VisitCompletionBlocker } from '../types';
import { blockerGuidance } from './billingReviewPresentation';

const { Text } = Typography;

interface Props {
  blockers: VisitCompletionBlocker[];
  worklist: BillingWorklistItem[];
}

/**
 * G4.5d3c-3b2 (D-094) — what still stands between this visit and completion.
 *
 * Every blocker names WHAT is wrong, WHO resolves it and WHAT to do — and for
 * unbilled work it names the actual items. A blocker with no remediation is
 * exactly what the 3b0 audit called unacceptable. Counter staff are never
 * offered a clinical action (completing a procedure, prescribing) to clear one.
 */
export function BillingBlockersPanel({ blockers, worklist }: Props) {
  if (blockers.length === 0) {
    return (
      <Alert
        type="success"
        showIcon
        role="status"
        message="Nothing is outstanding for this visit."
        description="Billing is resolved. Completing the visit itself is a separate counter action."
      />
    );
  }

  const unbilled = worklist.filter((item) => item.state === 'READY' && !item.billed);

  return (
    <Card size="small" title={`Outstanding (${blockers.length})`}>
      <List
        dataSource={blockers}
        rowKey="code"
        renderItem={(blocker) => {
          const guidance = blockerGuidance(blocker.code, blocker.message);
          return (
            // role="status" so a screen reader announces the outstanding work
            // rather than leaving it as decoration.
            <List.Item style={{ padding: '10px 0' }} role="status">
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Text strong>{guidance.title}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {guidance.who} · {guidance.action}
                </Text>
                {blocker.code === 'UNBILLED_CHARGEABLE_ITEMS' && unbilled.length > 0 && (
                  <ul style={{ margin: '2px 0 0', paddingInlineStart: 20 }}>
                    {unbilled.map((item) => (
                      <li key={`${item.sourceType}:${item.sourceId}`}>
                        <Text style={{ fontSize: 12 }}>{item.description}</Text>
                      </li>
                    ))}
                  </ul>
                )}
              </Space>
            </List.Item>
          );
        }}
      />
    </Card>
  );
}
