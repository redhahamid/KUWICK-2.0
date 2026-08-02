import { useState } from 'react';
import { Alert, Card, Descriptions, Empty, Image, Skeleton, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { VisitHistoryDetail } from '../types';
import { authorisationState, documentLabel, inclusiveDays, staffName } from '../documents/documentPresentation';
import { INVOICE_STATUS_COLOR, INVOICE_STATUS_LABEL, invoiceMoney, lineSource, money } from '../invoice/invoicePresentation';
import { useAttachmentBlobUrls } from '../hooks/useAttachmentBlobUrls';

const { Text, Title, Paragraph } = Typography;

/**
 * G4 (D-067) — a previous visit, rendered read-only.
 *
 * This is a purpose-built read-only view, NOT the working tabs with their
 * buttons hidden. Nothing in this file — or anything it imports — can write:
 * `useAttachmentBlobUrls` performs an authenticated GET, and the document and
 * invoice helpers are pure formatting. A test asserts the absence of mutation
 * hooks against the source, so a future edit that reaches for one fails.
 *
 * Section order follows the brief and matches how a consultation is read:
 * context → note → observations → diagnosis → orders → medications →
 * documents → attachments → invoice.
 */

interface ReadOnlyVisitDetailProps {
  detail: VisitHistoryDetail | undefined;
  isLoading: boolean;
  error: unknown;
  /** Narrower stacking for tablet/mobile. */
  compact?: boolean;
}

export function ReadOnlyVisitDetail({ detail, isLoading, error, compact }: ReadOnlyVisitDetailProps) {
  if (isLoading) {
    return (
      <div style={{ padding: 12 }}>
        <Skeleton active paragraph={{ rows: 5 }} />
        <Text type="secondary">Loading this visit’s record…</Text>
      </div>
    );
  }
  if (error || !detail) {
    return (
      <Alert
        type="error"
        showIcon
        style={{ margin: 12 }}
        message="This visit could not be opened"
        description="It may belong to another patient or to a branch you are not authorised for. Nothing has been changed."
      />
    );
  }

  const { visit } = detail;
  const columns = compact ? 1 : 2;

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }} className="kw-history-detail">
      <VisitContext detail={detail} columns={columns} />
      <NoteSection detail={detail} />
      <ObservationsSection detail={detail} columns={columns} />
      <DiagnosisSection detail={detail} />
      <OrdersSection detail={detail} />
      <MedicationsSection detail={detail} />
      <DocumentsSection detail={detail} />
      <AttachmentsSection detail={detail} visitId={visit.id} />
      <InvoiceSection detail={detail} />
    </Space>
  );
}

function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card size="small" title={title} extra={extra} className="kw-history-section" data-section={title}>
      {children}
    </Card>
  );
}

function NothingRecorded({ what }: { what: string }) {
  // "Nothing recorded" is a real clinical statement and is never dressed up
  // as a zero or a normal value.
  return <Text type="secondary">No {what} recorded for this visit.</Text>;
}

function VisitContext({ detail, columns }: { detail: VisitHistoryDetail; columns: number }) {
  const { visit } = detail;
  return (
    <Section title="Visit">
      <Descriptions column={columns} size="small">
        <Descriptions.Item label="Visit number">{visit.visitNumber}</Descriptions.Item>
        <Descriptions.Item label="Date &amp; time">
          {dayjs(visit.checkInAt).format('D MMM YYYY, HH:mm')}
        </Descriptions.Item>
        {visit.clinic?.name && <Descriptions.Item label="Branch">{visit.clinic.name}</Descriptions.Item>}
        <Descriptions.Item label="Attending doctor">{visit.staff?.fullName ?? 'Not recorded'}</Descriptions.Item>
        <Descriptions.Item label="Billing">{visit.billingType}</Descriptions.Item>
        {visit.queueTicket && (
          <Descriptions.Item label="Queue">
            {visit.queueTicket.ticketNumber} · {visit.queueTicket.queueType}
          </Descriptions.Item>
        )}
        {visit.presentingComplaint && (
          <Descriptions.Item label="Presenting complaint" span={columns}>
            {visit.presentingComplaint}
          </Descriptions.Item>
        )}
      </Descriptions>
    </Section>
  );
}

function NoteSection({ detail }: { detail: VisitHistoryDetail }) {
  if (detail.notes.length === 0) {
    return (
      <Section title="Clinical note">
        <NothingRecorded what="clinical note" />
      </Section>
    );
  }
  return (
    <Section title="Clinical note">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {detail.notes.map((note) => {
          // C0/D-064 vocabulary: the snapshot is the historical truth. A note
          // signed by someone since renamed still shows the name it was
          // signed under.
          const author = note.authorNameSnapshot ?? note.author?.fullName ?? null;
          const signer = note.signerNameSnapshot ?? note.signedBy?.fullName ?? null;
          return (
            <div key={note.id} className="kw-history-note">
              <Space wrap size={6} style={{ marginBottom: 4 }}>
                <Tag color={note.status === 'SIGNED' ? 'green' : 'gold'}>
                  {note.status === 'SIGNED' ? 'Signed' : 'Draft'}
                </Tag>
                {note.entryType === 'AMENDMENT' && <Tag color="blue">Amendment</Tag>}
                {note.hasAmendment && <Tag color="blue">Amended later</Tag>}
                {note.legacyAuthorUnknown && <Tag>Author not recorded (legacy)</Tag>}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {author ? `By ${author}` : 'Author not recorded'}
                  {' · '}
                  {dayjs(note.createdAt).format('D MMM YYYY, HH:mm')}
                  {note.signedAt ? ` · signed ${dayjs(note.signedAt).format('D MMM YYYY, HH:mm')}` : ''}
                  {signer && signer !== author ? ` by ${signer}` : ''}
                </Text>
              </Space>
              {note.notes ? (
                <div
                  className="kw-history-note-body"
                  // The stored note is rich text produced by the clinic's own
                  // editor; it is displayed exactly as written, never edited.
                  dangerouslySetInnerHTML={{ __html: note.notes }}
                />
              ) : (
                <Text type="secondary">This note is empty.</Text>
              )}
            </div>
          );
        })}
      </Space>
    </Section>
  );
}

function ObservationsSection({ detail, columns }: { detail: VisitHistoryDetail; columns: number }) {
  const latest = detail.observations[0];
  if (!latest) {
    return (
      <Section title="Observations">
        <NothingRecorded what="observations" />
      </Section>
    );
  }
  const rows: [string, string | null][] = [
    ['BP', latest.bpSystolic && latest.bpDiastolic ? `${latest.bpSystolic}/${latest.bpDiastolic} mmHg` : null],
    ['Pulse', latest.pulse ? `${latest.pulse} bpm` : null],
    ['Temperature', latest.temperature ? `${latest.temperature} °C` : null],
    ['SpO₂', latest.spo2 ? `${latest.spo2}%` : null],
    ['Resp. rate', latest.respRate ? `${latest.respRate}/min` : null],
    ['Weight', latest.weight ? `${latest.weight} kg` : null],
    ['Height', latest.height ? `${latest.height} cm` : null],
    ['BMI', latest.bmi ? String(latest.bmi) : null],
    ['Glucose', latest.glucose ? `${latest.glucose} mmol/L` : null],
    ['Pain score', latest.painScore !== null ? String(latest.painScore) : null],
  ];
  const present = rows.filter(([, value]) => value !== null);

  return (
    <Section title="Observations">
      {present.length === 0 ? (
        <NothingRecorded what="observations" />
      ) : (
        <Descriptions column={columns} size="small">
          {present.map(([label, value]) => (
            <Descriptions.Item key={label} label={label}>
              {value}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
      <Text type="secondary" style={{ fontSize: 12 }}>
        {latest.legacyRecorderUnknown
          ? 'Recorded by: not captured (legacy record)'
          : `Recorded by ${latest.recorderNameSnapshot ?? latest.recordedBy?.fullName ?? 'unknown'}`}
        {' · '}
        {dayjs(latest.recordedAt).format('D MMM YYYY, HH:mm')}
      </Text>
    </Section>
  );
}

function DiagnosisSection({ detail }: { detail: VisitHistoryDetail }) {
  const active = detail.diagnoses.filter((d) => d.recordStatus === 'ACTIVE');
  const removed = detail.diagnoses.filter((d) => d.recordStatus !== 'ACTIVE');
  return (
    <Section title="Diagnosis">
      {active.length === 0 ? (
        <NothingRecorded what="diagnosis" />
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {active.map((diagnosis) => (
            <div key={diagnosis.id}>
              <Space wrap size={6}>
                <Text strong>{diagnosis.name}</Text>
                {diagnosis.icd10Code && <Tag>{diagnosis.icd10Code}</Tag>}
                {/* G2a — a null priority means nobody recorded one. It is
                    never rendered as "Secondary". */}
                <Tag color={diagnosis.priority === 'PRIMARY' ? 'red' : undefined}>
                  {diagnosis.priority === 'PRIMARY'
                    ? 'Primary'
                    : diagnosis.priority === 'SECONDARY'
                      ? 'Secondary'
                      : 'Priority not recorded'}
                </Tag>
              </Space>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {diagnosis.addedByNameSnapshot ? `Added by ${diagnosis.addedByNameSnapshot}` : 'Added by: not recorded'}
                  {' · '}
                  {dayjs(diagnosis.createdAt).format('D MMM YYYY')}
                </Text>
              </div>
            </div>
          ))}
        </Space>
      )}
      {removed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 10 }}
          message={`${removed.length} diagnosis entr${removed.length === 1 ? 'y' : 'ies'} removed in error`}
          description={
            <Space direction="vertical" size={2}>
              {removed.map((diagnosis) => (
                <Text key={diagnosis.id} delete type="secondary">
                  {diagnosis.name}
                  {diagnosis.removalReason ? ` — ${diagnosis.removalReason}` : ''}
                </Text>
              ))}
            </Space>
          }
        />
      )}
    </Section>
  );
}

const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: 'default',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

function OrdersSection({ detail }: { detail: VisitHistoryDetail }) {
  if (detail.orders.length === 0) {
    return (
      <Section title="Orders &amp; procedures">
        <NothingRecorded what="orders or procedures" />
      </Section>
    );
  }
  return (
    <Section title="Orders &amp; procedures">
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {detail.orders.map((order) => {
          const activeFiles = (order.attachments ?? []).filter((a) => a.recordStatus === 'ACTIVE');
          return (
            <div key={order.id}>
              <Space wrap size={6}>
                <Text strong>{order.procedureName}</Text>
                <Tag color={ORDER_STATUS_COLOR[order.status]}>{order.status.replace('_', ' ')}</Tag>
                {order.code && <Tag>{order.code}</Tag>}
              </Space>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Ordered {dayjs(order.requestedAt).format('D MMM YYYY, HH:mm')}
                  {order.completedAt ? ` · completed ${dayjs(order.completedAt).format('D MMM YYYY, HH:mm')}` : ''}
                </Text>
              </div>
              {order.instruction && <div><Text type="secondary">Instruction: {order.instruction}</Text></div>}
              {order.result && <Paragraph style={{ marginBottom: 0 }}>Result: {order.result}</Paragraph>}
              {order.cancelReason && <div><Text type="danger">Cancelled: {order.cancelReason}</Text></div>}
              {activeFiles.length > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {activeFiles.length} result file{activeFiles.length === 1 ? '' : 's'} attached
                </Text>
              )}
            </div>
          );
        })}
      </Space>
    </Section>
  );
}

function MedicationsSection({ detail }: { detail: VisitHistoryDetail }) {
  if (detail.prescriptions.length === 0) {
    return (
      <Section title="Medications">
        <NothingRecorded what="medication" />
      </Section>
    );
  }
  return (
    <Section title="Medications">
      <Table
        size="small"
        pagination={false}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        dataSource={detail.prescriptions}
        columns={[
          {
            title: 'Medication',
            key: 'name',
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Text strong>{row.item?.name ?? 'Medication'}</Text>
                {row.item?.strengthMg && <Text type="secondary">{row.item.strengthMg} mg</Text>}
              </Space>
            ),
          },
          {
            title: 'Dose',
            key: 'dose',
            render: (_, row) => `${row.amount}${row.unit ? ` ${row.unit}` : ''}`,
          },
          { title: 'Frequency', dataIndex: 'frequency', key: 'frequency' },
          {
            title: 'Duration',
            key: 'duration',
            render: (_, row) => `${row.durationDays} day${row.durationDays === 1 ? '' : 's'}`,
          },
          { title: 'Qty', dataIndex: 'quantity', key: 'quantity' },
          {
            title: 'Instructions',
            key: 'instruction',
            render: (_, row) => row.remark ?? row.indication ?? '—',
          },
          {
            title: 'Prescriber',
            key: 'prescriber',
            render: (_, row) => row.prescribedBy?.fullName ?? 'Not recorded',
          },
          {
            title: 'Dispensing',
            key: 'status',
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Tag color={row.status === 'DISPENSED' ? 'green' : row.status === 'CANCELLED' ? 'red' : 'default'}>
                  {row.status}
                </Tag>
                {/* Weight-based paediatric dosing is shown as the working the
                    prescriber actually recorded, not recalculated here. */}
                {row.calcMethod === 'WEIGHT_BASED' && row.calcWeightKg && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {row.calcWeightKg} kg{row.calcDoseRateMgKg ? ` × ${row.calcDoseRateMgKg} mg/kg` : ''}
                  </Text>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Section>
  );
}

function DocumentsSection({ detail }: { detail: VisitHistoryDetail }) {
  const active = detail.documents.filter((doc) => doc.recordStatus === 'ACTIVE');
  const voided = detail.documents.filter((doc) => doc.recordStatus === 'VOIDED');

  return (
    <Section title="Documents">
      {active.length === 0 ? (
        <NothingRecorded what="document" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {active.map((doc) => {
            const state = authorisationState(doc);
            const days = inclusiveDays(doc.startDate, doc.endDate);
            return (
              <div key={doc.id} className="kw-history-document">
                <Space wrap size={6}>
                  <Text strong>{documentLabel(doc)}</Text>
                  <Tag>{state.label}</Tag>
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Issued {dayjs(doc.issuedDate).format('D MMM YYYY')}
                    {days !== null ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}
                    {doc.referredTo ? ` · to ${doc.referredTo}` : ''}
                    {staffName(doc.issuedBy) ? ` · by ${staffName(doc.issuedBy)}` : ''}
                  </Text>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>{state.detail}</Text>
              </div>
            );
          })}
        </Space>
      )}

      {voided.length > 0 && (
        // Voided documents are kept visually separate from the record's live
        // content — never mixed into the same list with a colour difference.
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 10 }}
          message={`${voided.length} voided document${voided.length === 1 ? '' : 's'}`}
          description={
            <Space direction="vertical" size={2}>
              {voided.map((doc) => (
                <Text key={doc.id} type="secondary">
                  <span style={{ textDecoration: 'line-through' }}>{documentLabel(doc)}</span>
                  {doc.voidReason ? ` — ${doc.voidReason}` : ''}
                  {doc.voidedByNameSnapshot ? ` (voided by ${doc.voidedByNameSnapshot})` : ''}
                </Text>
              ))}
            </Space>
          }
        />
      )}
    </Section>
  );
}

function AttachmentsSection({ detail, visitId }: { detail: VisitHistoryDetail; visitId: string }) {
  const active = detail.attachments.filter((a) => a.recordStatus === 'ACTIVE');
  const removed = detail.attachments.filter((a) => a.recordStatus !== 'ACTIVE');
  const blobUrls = useAttachmentBlobUrls(visitId, active);
  const images = active.filter((a) => a.mimeType?.startsWith('image/') && blobUrls[a.id]);
  const others = active.filter((a) => !images.includes(a));

  return (
    <Section title="Attachments">
      {active.length === 0 ? (
        <NothingRecorded what="attachment" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {images.length > 0 && (
            <Image.PreviewGroup>
              <Space wrap size={8}>
                {images.map((file) => (
                  <Image
                    key={file.id}
                    src={blobUrls[file.id]}
                    alt={file.fileName}
                    width={96}
                    height={96}
                    style={{ objectFit: 'cover', borderRadius: 6 }}
                  />
                ))}
              </Space>
            </Image.PreviewGroup>
          )}
          {others.map((file) => (
            <Text key={file.id} type="secondary">
              {file.fileName} · {(file.fileSize / 1024).toFixed(0)} KB
            </Text>
          ))}
        </Space>
      )}
      {removed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 10 }}
          message={`${removed.length} file${removed.length === 1 ? '' : 's'} removed in error`}
          description={
            <Space direction="vertical" size={2}>
              {removed.map((file) => (
                <Text key={file.id} type="secondary">
                  <span style={{ textDecoration: 'line-through' }}>{file.fileName}</span>
                  {file.removalReason ? ` — ${file.removalReason}` : ''}
                </Text>
              ))}
            </Space>
          }
        />
      )}
    </Section>
  );
}

function InvoiceSection({ detail }: { detail: VisitHistoryDetail }) {
  if (detail.invoices.length === 0) {
    return (
      <Section title="Invoice">
        <NothingRecorded what="invoice" />
      </Section>
    );
  }
  return (
    <Section title="Invoice">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {detail.invoices.map((invoice) => {
          const amounts = invoiceMoney(invoice);
          return (
            <div key={invoice.id}>
              <Space wrap size={6}>
                <Text strong>{invoice.invoiceNumber}</Text>
                <Tag color={INVOICE_STATUS_COLOR[invoice.status]}>{INVOICE_STATUS_LABEL[invoice.status]}</Tag>
                <Text>{money(amounts.total)}</Text>
              </Space>
              {invoice.lines && invoice.lines.length > 0 && (
                <Space direction="vertical" size={0} style={{ width: '100%', marginTop: 4 }}>
                  {invoice.lines.map((line) => {
                    const source = lineSource(line);
                    return (
                      <Text key={line.id} type="secondary" style={{ fontSize: 12 }}>
                        {line.description}
                        {source.label ? ` · ${source.label}` : ''} — {money(line.amount)}
                      </Text>
                    );
                  })}
                </Space>
              )}
              {invoice.status === 'PAID' && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Patient paid {money(invoice.patientPaidAmount)} · panel covered {money(invoice.panelCoveredAmount)}
                </Text>
              )}
            </div>
          );
        })}
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Historical charges, shown for reference only.
      </Text>
    </Section>
  );
}

/** Kept out of the section list: an explicit "this visit is empty" state. */
export function EmptyVisitNotice() {
  const [dismissed] = useState(false);
  if (dismissed) return null;
  return <Empty description="Nothing was recorded on this visit." />;
}
