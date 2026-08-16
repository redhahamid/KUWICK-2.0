import { useState } from 'react';
import { Button, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EyeOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDocuments, useVoidDocument } from '../hooks/useDocuments';
import { useDocumentTemplates } from '../hooks/useDocumentTemplates';
import { ApiError } from '../../core/api-client';
import { printTextDocument } from '../printTextDocument';
import { ClinicalDocument, Visit } from '../types';
import { BUILT_IN_TYPES, shortLabel, TYPE_COLOR } from '../documents/documentPresentation';
import { CreateDocumentDrawer } from '../documents/CreateDocumentDrawer';
import { DocumentPreviewDrawer } from '../documents/DocumentPreviewDrawer';
import { RailPanel } from './RailPanel';

const { Text } = Typography;

const CUSTOM_PREFIX = 'custom:';

/**
 * b3 PHASE F — the DOCUMENTS card.
 *
 * The last of the four canvas cards, and the one whose absence was still
 * costing something: the only way to issue an MC in Canvas was a control in
 * the visit band above, which the band's own comment describes as living on
 * borrowed time. A doctor who wanted to see what had already been issued this
 * visit had to leave the consult for the Documents workspace.
 *
 * SEARCH-FIRST, like Orders and Medications beside it. The picker is a type
 * chooser rather than a catalogue search, because the thing being chosen is
 * genuinely a short fixed list — six built-in types plus whatever the clinic
 * configured in Settings → Documents & Templates — and a search box over eight
 * items is a worse control than a list of eight items.
 *
 * NOT ONE-CLICK GENERATION. Choosing a type opens the same
 * `CreateDocumentDrawer` the Documents workspace uses, with the same per-type
 * fields, the same template engine and the same authorisation rules. A card
 * that generated an MC in one click would be generating a legal document
 * without anybody choosing the dates on it.
 *
 * NO SECOND TABLE. An MC is a `Document` row with `type = MC`, exactly as it
 * has always been, which is what makes an "MCs issued" report a query rather
 * than a reconciliation between two stores.
 */
export function DocumentsRail({ visit }: { visit: Visit }) {
  const [creatingType, setCreatingType] = useState<string>();
  const [previewing, setPreviewing] = useState<ClinicalDocument>();

  const { data: documents, isLoading, error } = useDocuments(visit.id);
  const { data: customTemplates } = useDocumentTemplates(true);
  const voidDocument = useVoidDocument(visit.id);

  const issued = documents ?? [];

  const typeOptions = [
    ...BUILT_IN_TYPES.map((type) => ({ value: type.value as string, label: type.label })),
    ...(customTemplates ?? []).map((template) => ({
      value: `${CUSTOM_PREFIX}${template.id}`,
      label: template.name,
    })),
  ];

  const remove = async (document: ClinicalDocument) => {
    try {
      // VOID, never delete. A document that has left the clinic cannot be
      // un-issued, and the row stays with who voided it and why — the same
      // rule the Documents workspace has always enforced, reached from here.
      await voidDocument.mutateAsync({ id: document.id, reason: 'Removed from the consultation' });
      message.success('Document voided');
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Failed to void the document');
    }
  };

  return (
    <>
      <RailPanel
        anchorId="canvas-documents"
        title="Documents"
        count={issued.length}
        isLoading={isLoading}
        error={error}
        // A first visit has none, and says so in the words a doctor would use
        // rather than "No data".
        emptyText="No documents issued for this visit yet."
        previewLimit={5}
        addControl={
          <Select
            style={{ width: 190 }}
            size="small"
            showSearch
            optionFilterProp="label"
            placeholder="Issue a document…"
            value={undefined}
            onChange={setCreatingType}
            options={typeOptions}
            aria-label="Issue a document"
          />
        }
        items={issued.map((document) => (
          <div className="kw-rail-row" key={document.id} data-document-id={document.id}>
            {/* b4 PIECE 1 — one line. Type, what it covers, and the actions.
                Who issued it moves to hover: it is the fact a doctor checks
                once, not the one they scan the list for. */}
            {/* Who issued it moves to HOVER — via a title attribute, so it
                stays in the DOM and the accessibility tree rather than existing
                only while a pointer is over it. It is the fact a doctor checks
                once, not the one they scan the list for. */}
            <Space
              size={6}
              wrap
              className="kw-rail-row-main"
              title={`Issued by ${document.issuedBy?.fullName ?? 'unknown'} · ${dayjs(
                document.issuedDate,
              ).format('DD/MM/YYYY')}`}
            >
              <Tag color={TYPE_COLOR[document.type]}>{shortLabel(document)}</Tag>
              <Text strong style={{ fontSize: 13 }}>
                {describeDates(document)}
              </Text>
            </Space>
            <Space size={4} className="kw-rail-row-actions">
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setPreviewing(document)}
                aria-label={`View ${shortLabel(document)}`}
              />
              <Button
                size="small"
                icon={<PrinterOutlined />}
                onClick={() => printTextDocument(shortLabel(document), document.content)}
                aria-label={`Print ${shortLabel(document)}`}
              />
              <Popconfirm
                title="Void this document?"
                description="It stays on the record as voided — nothing is deleted."
                okText="Void it"
                cancelText="Keep it"
                onConfirm={() => void remove(document)}
              >
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  aria-label={`Remove ${shortLabel(document)}`}
                />
              </Popconfirm>
            </Space>
          </div>
        ))}
      />

      {creatingType && (
        <CreateDocumentDrawer
          visit={visit}
          open
          initialType={creatingType}
          patientName={visit.patient?.name}
          patientIdentifier={visit.patient?.identifierValue}
          onClose={() => setCreatingType(undefined)}
        />
      )}

      {previewing && (
        <DocumentPreviewDrawer
          document={previewing}
          patientName={visit.patient?.name}
          onClose={() => setPreviewing(undefined)}
        />
      )}
    </>
  );
}

/**
 * What this document COVERS, in one line.
 *
 * Reads only stored fields, and omits what the schema does not hold rather
 * than rendering an empty label — an "MC · —" reads as missing data, where
 * "MC" alone reads as a document whose dates are on the document itself.
 */
export function describeDates(document: ClinicalDocument): string {
  if (document.type === 'TIME_SLIP') {
    const date = document.startDate ?? document.issuedDate;
    const hours = document.hours;
    return hours
      ? `${dayjs(date).format('DD/MM/YYYY')} · ${hours} hour${hours === 1 ? '' : 's'}`
      : dayjs(date).format('DD/MM/YYYY');
  }
  if (!document.startDate) return dayjs(document.issuedDate).format('DD/MM/YYYY');
  const start = dayjs(document.startDate);
  const end = document.endDate ? dayjs(document.endDate) : start;
  // A single-day MC prints as one date, not as "3/8 – 3/8". The range picker
  // and the one-day picker store the same shape, so this is the only place
  // that has to know the difference.
  if (start.isSame(end, 'day')) return start.format('DD/MM/YYYY');
  const days = end.diff(start, 'day') + 1;
  return `${start.format('DD/MM')} – ${end.format('DD/MM/YYYY')} · ${days} days`;
}
