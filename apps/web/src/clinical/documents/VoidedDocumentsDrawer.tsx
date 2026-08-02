import { Button, Drawer, Empty, List, Space, Tag, Typography } from 'antd';
import { EyeOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDocumentHistory } from '../hooks/useDocuments';
import { ClinicalDocument } from '../types';
import { TYPE_COLOR, documentLabel, downloadDocument, staffName } from './documentPresentation';

const { Text } = Typography;

interface VoidedDocumentsDrawerProps {
  visitId: string;
  open: boolean;
  patientName?: string;
  onClose: () => void;
  onPreview: (document: ClinicalDocument) => void;
}

function roleLabel(role?: string | null): string {
  return role ? role.replace(/_/g, ' ').toLowerCase() : '';
}

/**
 * G3b (§9) — voided documents live here, off the active workflow.
 *
 * A separate drawer rather than a "show voided" toggle in the active list:
 * mixing them into one list is exactly how a voided MC ends up being read as
 * a current one. Fetched only when opened. There is no edit, no restore and
 * no delete — the only actions are the two that let an authorised user answer
 * "what did we issue, and why was it withdrawn?".
 */
export function VoidedDocumentsDrawer({
  visitId,
  open,
  patientName,
  onClose,
  onPreview,
}: VoidedDocumentsDrawerProps) {
  const { data: history, isLoading } = useDocumentHistory(visitId, open);
  const voided = (history ?? []).filter((doc) => doc.recordStatus === 'VOIDED');

  return (
    <Drawer title="Voided documents" open={open} onClose={onClose} width={640}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
        These documents are no longer active. The original text, its issuer and its signature are preserved
        exactly as issued.
      </Text>

      {!isLoading && voided.length === 0 ? (
        <Empty description="No voided documents for this visit" />
      ) : (
        <List
          loading={isLoading}
          dataSource={voided}
          renderItem={(document: ClinicalDocument) => (
            <List.Item
              actions={[
                <Button key="preview" size="small" icon={<EyeOutlined />} onClick={() => onPreview(document)}>
                  Preview
                </Button>,
                <Button
                  key="download"
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => downloadDocument(document, patientName)}
                >
                  Download
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap size={4}>
                    <Tag color={TYPE_COLOR[document.type]}>{documentLabel(document)}</Tag>
                    <Tag color="error">Voided</Tag>
                    {document.signedAt && <Tag color="default">Was signed</Tag>}
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                    <div>
                      Created by {staffName(document.issuedBy) ?? 'Not recorded'} ·{' '}
                      {dayjs(document.createdAt).format('D MMM YYYY, HH:mm')}
                    </div>
                    {document.signedAt && (
                      <div>
                        Signed {dayjs(document.signedAt).format('D MMM YYYY, HH:mm')}
                        {staffName(document.signedBy) ? ` by ${staffName(document.signedBy)}` : ''}
                      </div>
                    )}
                    <div>
                      Voided by {document.voidedByNameSnapshot ?? 'Not recorded'}
                      {document.voidedByRoleSnapshot ? ` (${roleLabel(document.voidedByRoleSnapshot)})` : ''} ·{' '}
                      {document.voidedAt ? dayjs(document.voidedAt).format('D MMM YYYY, HH:mm') : '—'}
                    </div>
                    {document.voidReason && <div>Reason: {document.voidReason}</div>}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
}
