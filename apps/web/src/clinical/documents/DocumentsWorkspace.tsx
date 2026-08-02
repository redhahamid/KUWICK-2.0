import { useState } from 'react';
import { Button, Dropdown, Empty, Grid, Space, Tag, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  MoreOutlined,
  PrinterOutlined,
  StopOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDocumentHistory, useDocuments, useSignDocument, useVoidDocument } from '../hooks/useDocuments';
import { printTextDocument } from '../printTextDocument';
import { RemoveClinicalRecordModal } from '../sections/RemoveClinicalRecordModal';
import { ApiError } from '../../core/api-client';
import { ClinicalDocument, Visit } from '../types';
import { CreateDocumentDrawer } from './CreateDocumentDrawer';
import { DocumentPreviewDrawer } from './DocumentPreviewDrawer';
import { VoidedDocumentsDrawer } from './VoidedDocumentsDrawer';
import {
  TYPE_COLOR,
  documentDetails,
  documentLabel,
  downloadDocument,
  staffName,
} from './documentPresentation';

const { Text } = Typography;

interface DocumentsWorkspaceProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
  /** Set by the section header's "+ Create Document" so one click opens it. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

/**
 * G3b — the clinical document workspace.
 *
 * What it replaces: a permanently-open "New Document" form card sitting on
 * top of a list whose every row was the document's entire body text, with
 * three unlabelled icon buttons. That read as a text-file manager, not as a
 * GP's issued paperwork.
 *
 * What it is now: the active documents, each stating what it is, who created
 * it, when, and the fields that actually matter for its type — an MC's rest
 * period and day count, a referral's recipient — with named actions. Creating
 * is a deliberate flow in a drawer rather than a form permanently occupying
 * the top of the section. Voided documents are not here at all; they are one
 * click away in their own history drawer, which is the only way a voided MC
 * cannot be misread as current.
 */
export function DocumentsWorkspace({
  visit,
  patientName,
  patientIdentifier,
  createOpen,
  onCreateOpenChange,
}: DocumentsWorkspaceProps) {
  const screens = Grid.useBreakpoint();
  const compact = !screens.md;

  // G3b (§11) — 44px minimum touch target on small screens.
  //
  // antd's `size="small"` is 24px, which is right for a mouse and far too
  // small for a thumb; the live check measured it at 24px and failed, which is
  // exactly the kind of thing that is invisible on a desktop browser. Size is
  // therefore chosen per breakpoint, with an explicit floor because even
  // antd's "large" (40px) is under the bar.
  const btnSize = compact ? ('middle' as const) : ('small' as const);
  const touch = compact ? { minHeight: 44, paddingInline: 14 } : undefined;

  const { data: documents, isLoading } = useDocuments(visit.id);
  // Cheap once loaded, and it is what tells the doctor a voided document
  // exists at all — without it the section silently under-reports history.
  const { data: history } = useDocumentHistory(visit.id, true);
  const signDocument = useSignDocument(visit.id);
  const voidDocument = useVoidDocument(visit.id);

  const [internalCreate, setInternalCreate] = useState(false);
  const [previewing, setPreviewing] = useState<ClinicalDocument | null>(null);
  const [voiding, setVoiding] = useState<ClinicalDocument | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const createDrawerOpen = createOpen ?? internalCreate;
  const setCreateOpen = (open: boolean) => {
    setInternalCreate(open);
    onCreateOpenChange?.(open);
  };

  const active = documents ?? [];
  const voidedCount = (history ?? []).filter((doc) => doc.recordStatus === 'VOIDED').length;

  const sign = (document: ClinicalDocument) =>
    signDocument
      .mutateAsync({ id: document.id, expectedVersion: document.version })
      .then(() => message.success('Document signed'))
      .catch((error) =>
        message.error(error instanceof ApiError ? error.message : 'Failed to sign the document'),
      );

  const print = (document: ClinicalDocument) => printTextDocument(documentLabel(document), document.content);

  // Desktop shows the actions inline with words on them; small screens move
  // the secondary ones into a labelled menu so nothing is a bare icon and no
  // row has to scroll sideways.
  const actionsFor = (document: ClinicalDocument) => {
    const preview = (
      <Button
        key="preview"
        size={btnSize}
        style={touch}
        icon={<EyeOutlined />}
        onClick={() => setPreviewing(document)}
      >
        Preview
      </Button>
    );
    const menuItems = [
      { key: 'print', icon: <PrinterOutlined />, label: 'Print', onClick: () => print(document) },
      {
        key: 'download',
        icon: <DownloadOutlined />,
        label: 'Download',
        onClick: () => downloadDocument(document, patientName),
      },
      ...(document.signedAt
        ? []
        : [{ key: 'sign', icon: <CheckCircleOutlined />, label: 'Sign', onClick: () => void sign(document) }]),
      { type: 'divider' as const, key: 'sep' },
      {
        key: 'void',
        icon: <StopOutlined />,
        label: 'Void document',
        danger: true,
        onClick: () => setVoiding(document),
      },
    ];

    if (compact) {
      return (
        <Space size={4}>
          {preview}
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button size={btnSize} style={touch} icon={<MoreOutlined />}>
              Actions
            </Button>
          </Dropdown>
        </Space>
      );
    }

    return (
      <Space size={4} wrap>
        {preview}
        <Button size="small" icon={<PrinterOutlined />} onClick={() => print(document)}>
          Print
        </Button>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => downloadDocument(document, patientName)}
        >
          Download
        </Button>
        {!document.signedAt && (
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            loading={signDocument.isPending}
            onClick={() => void sign(document)}
          >
            Sign
          </Button>
        )}
        <Button size="small" danger icon={<StopOutlined />} onClick={() => setVoiding(document)}>
          Void
        </Button>
      </Space>
    );
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          {active.length === 0
            ? 'No active documents for this visit'
            : `${active.length} active document${active.length === 1 ? '' : 's'}`}
        </Text>
        <Space wrap size={8}>
          {voidedCount > 0 && (
            <Button size={btnSize} style={touch} icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
              {voidedCount} voided
            </Button>
          )}
          <Button type="primary" size={btnSize} style={touch} onClick={() => setCreateOpen(true)}>
            + Create Document
          </Button>
        </Space>
      </div>

      {!isLoading && active.length === 0 ? (
        <Empty
          image={<FileTextOutlined style={{ fontSize: 36, opacity: 0.25 }} />}
          description="Nothing issued for this visit yet"
        >
          <Button type="primary" size={btnSize} style={touch} onClick={() => setCreateOpen(true)}>
            + Create Document
          </Button>
        </Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {active.map((document) => {
            const details = documentDetails(document);
            return (
              <div
                key={document.id}
                style={{
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Space wrap size={4} style={{ marginBottom: 6 }}>
                    <Tag color={TYPE_COLOR[document.type]} style={{ marginInlineEnd: 0 }}>
                      {documentLabel(document)}
                    </Tag>
                    {document.signedAt ? (
                      <Tag color="green" icon={<CheckCircleOutlined />}>
                        Signed
                      </Tag>
                    ) : (
                      <Tag>Not signed</Tag>
                    )}
                  </Space>

                  {details.length > 0 && (
                    <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                      {details.map((detail) => (
                        <div key={detail.label}>
                          <Text type="secondary">{detail.label}: </Text>
                          <Text>{detail.value}</Text>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6, lineHeight: 1.7 }}>
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
                  </div>
                </div>

                <div style={{ flex: '0 0 auto' }}>{actionsFor(document)}</div>
              </div>
            );
          })}
        </div>
      )}

      <CreateDocumentDrawer
        visit={visit}
        open={createDrawerOpen}
        patientName={patientName}
        patientIdentifier={patientIdentifier}
        onClose={() => setCreateOpen(false)}
      />

      <DocumentPreviewDrawer
        document={previewing}
        patientName={patientName}
        onClose={() => setPreviewing(null)}
      />

      <VoidedDocumentsDrawer
        visitId={visit.id}
        open={historyOpen}
        patientName={patientName}
        onClose={() => setHistoryOpen(false)}
        onPreview={(document) => setPreviewing(document)}
      />

      <RemoveClinicalRecordModal
        open={Boolean(voiding)}
        title="Void document"
        okText="Confirm void"
        retentionMessage="This document will no longer appear as active. The original document and audit history will remain preserved."
        placeholder="e.g. Wrong dates entered; issued to the wrong patient; superseded by a corrected MC"
        details={[
          { label: 'Document', value: voiding ? documentLabel(voiding) : null },
          ...(voiding ? documentDetails(voiding).map((d) => ({ label: d.label, value: d.value })) : []),
          { label: 'Created by', value: voiding ? staffName(voiding.issuedBy) ?? 'Not recorded' : null },
          {
            label: 'Created',
            value: voiding ? dayjs(voiding.createdAt).format('D MMM YYYY, HH:mm') : null,
          },
          {
            label: 'Signed',
            value: voiding?.signedAt
              ? `${dayjs(voiding.signedAt).format('D MMM YYYY, HH:mm')}${
                  staffName(voiding.signedBy) ? ` — ${staffName(voiding.signedBy)}` : ''
                }`
              : 'Not signed',
          },
        ]}
        pending={voidDocument.isPending}
        successMessage="Document voided — the original is preserved"
        errorMessage="Failed to void the document"
        onConfirm={(reason) =>
          voidDocument.mutateAsync({ id: voiding!.id, reason, expectedVersion: voiding!.version })
        }
        onClose={() => setVoiding(null)}
      />
    </div>
  );
}
