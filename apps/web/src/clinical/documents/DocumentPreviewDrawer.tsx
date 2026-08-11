import { Alert, Button, Descriptions, Drawer, Space, Tag } from 'antd';
import { CheckCircleOutlined, DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { printTextDocument } from '../printTextDocument';
import { ClinicalDocument } from '../types';
import {
  authorisationState,
  canProduceFinalCopy,
  documentDetails,
  documentLabel,
  downloadDocument,
  staffName,
} from './documentPresentation';

interface DocumentPreviewDrawerProps {
  document: ClinicalDocument | null;
  patientName?: string;
  onClose: () => void;
}

/**
 * G3b (§10) — preview shows the exact stored text, never a re-render.
 *
 * Preview, print and download are three separate code paths and are treated
 * as such, but all three read the same stored `content` and all three carry
 * the same voided state. A voided document is legible here — the clinic has
 * to be able to answer "what did we issue?" — but it can never be mistaken
 * for a current one: red banner on screen, red banner and a VOID watermark
 * on paper, and a void notice at the top of the downloaded file.
 */
export function DocumentPreviewDrawer({ document, patientName, onClose }: DocumentPreviewDrawerProps) {
  const voided = document?.recordStatus === 'VOIDED';
  // G3b closure (D-064) — preview is the ONE surface a draft clinical
  // document stays open on, so front desk can check the wording. Print and
  // download are shut until a doctor authorises it.
  const state = document ? authorisationState(document) : null;
  const canProduce = document ? canProduceFinalCopy(document) : false;

  const voidNotice = document
    ? {
        at: document.voidedAt ? dayjs(document.voidedAt).format('D MMM YYYY, HH:mm') : null,
        by: document.voidedByNameSnapshot,
        reason: document.voidReason,
      }
    : undefined;

  return (
    <Drawer
      title={document ? documentLabel(document) : 'Document'}
      open={Boolean(document)}
      onClose={onClose}
      width={720}
      styles={{ body: { paddingTop: 12 } }}
      extra={
        document ? (
          <Space wrap>
            <Button
              icon={<PrinterOutlined />}
              disabled={!canProduce}
              onClick={() =>
                printTextDocument(documentLabel(document), document.content, {
                  ...(voided ? { voided: voidNotice } : {}),
                  authorisation: state?.detail,
                })
              }
            >
              Print
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!canProduce}
              onClick={() => downloadDocument(document, patientName)}
            >
              Download
            </Button>
          </Space>
        ) : undefined
      }
    >
      {document && (
        <>
          {/* G3b closure (D-064) — an unauthorised clinical document says so
              in the loudest place available, and cannot be printed at all. */}
          {state?.isDraft && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="DRAFT — NOT CLINICALLY AUTHORISED"
              description="This document has not been authorised by a doctor. It cannot be printed or downloaded, and must not be given to the patient in this state."
            />
          )}

          {voided && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="This document has been voided and is no longer valid"
              description={
                <>
                  {voidNotice?.at && (
                    <div>
                      Voided {voidNotice.at}
                      {voidNotice.by ? ` by ${voidNotice.by}` : ''}
                      {document.voidedByRoleSnapshot
                        ? ` (${document.voidedByRoleSnapshot.replace(/_/g, ' ').toLowerCase()})`
                        : ''}
                    </div>
                  )}
                  {voidNotice?.reason && <div>Reason: {voidNotice.reason}</div>}
                </>
              }
            />
          )}

          <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Issued">
              {dayjs(document.issuedDate).format('D MMM YYYY')}
            </Descriptions.Item>
            <Descriptions.Item label="Created by">
              {staffName(document.issuedBy) ?? 'Not recorded'}
              <span style={{ color: '#8c8c8c' }}>
                {' '}
                · {dayjs(document.createdAt).format('D MMM YYYY, HH:mm')}
              </span>
            </Descriptions.Item>
            {documentDetails(document).map((detail) => (
              <Descriptions.Item key={detail.label} label={detail.label}>
                {detail.value}
              </Descriptions.Item>
            ))}
            <Descriptions.Item label="Authorisation">
              <Tag
                color={state?.tone === 'authorised' ? 'green' : state?.tone === 'issued' ? 'blue' : state?.tone === 'draft' ? 'orange' : 'default'}
                icon={state?.tone === 'authorised' ? <CheckCircleOutlined /> : undefined}
              >
                {state?.label}
              </Tag>
              {state?.detail && (
                <div style={{ marginTop: 4, fontSize: 12, color: '#8c8c8c' }}>{state.detail}</div>
              )}
            </Descriptions.Item>
          </Descriptions>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              fontFamily: "'Courier New', monospace",
              fontSize: 13,
              background: '#fafafa',
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              padding: 16,
              margin: 0,
            }}
          >
            {document.content}
          </pre>
        </>
      )}
    </Drawer>
  );
}
