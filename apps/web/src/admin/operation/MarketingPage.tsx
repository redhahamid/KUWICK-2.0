import { useState } from 'react';
import { App, Button, Input, InputNumber, Modal, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCan } from '../../core/hooks/useCan';
import {
  useMarkDispatchOpened,
  useMarketingAudience,
  useMarketingHistory,
  useMarketingTemplates,
  usePrepareDispatch,
  useProgrammes,
} from '../hooks/useAdmin';
import type { PreparedDispatchResult } from '../types';

/**
 * MARKETING — an audience builder and a template library.
 *
 * THE SENTENCE THIS SCREEN EXISTS TO KEEP SAYING: Kuwick sends nothing. There
 * is no WhatsApp integration, so a staff member sends each message themselves,
 * and the history records PREPARED and at most OPENED — never SENT and never
 * DELIVERED, because neither is something this system observes.
 */
export function MarketingPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const programmes = useProgrammes();
  const templates = useMarketingTemplates();
  const history = useMarketingHistory({});

  const [criteria, setCriteria] = useState<Record<string, string | number | undefined>>({});
  const [built, setBuilt] = useState(false);
  const audience = useMarketingAudience({ ...criteria, clinicId }, built);

  /**
   * THE SENDING QUEUE — the part that was missing.
   *
   * The audience builder, the templates and the history all existed; what did
   * not was any way to get FROM a built audience TO a message, so `prepare`
   * and `markOpened` were unreachable endpoints and the history table could
   * only ever be empty. This is the manual queue the previous marketing
   * capability had: one row per patient, a link that opens WhatsApp with the
   * text already in it, and a record of the click.
   *
   * It is still not sending. Each row is opened by a person, one at a time,
   * and the furthest this screen will ever claim is OPENED.
   */
  const mayPrepare = useCan('marketing.manage');
  const prepare = usePrepareDispatch();
  const markOpened = useMarkDispatchOpened();
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [audienceName, setAudienceName] = useState('');
  const [queue, setQueue] = useState<PreparedDispatchResult | null>(null);
  const [opened, setOpened] = useState<Record<string, true>>({});

  return (
    <AdminShell
      error={firstError(programmes, templates, history, audience)}
      title="Marketing"
      subtitle="Build an audience from live data, prepare a message from a template, and send it yourself."
    >
      <AdminNotice tone="warn">
        Kuwick has no WhatsApp integration and sends nothing. It builds the list, renders the message, and records that
        the text was PREPARED. Whether the patient received it is not something this system can know, so it never says
        that they did.
      </AdminNotice>

      <div className="kw-adminGrid kw-adminGrid--sidebar">
        <AdminSection title="Audience" padded={false}>
          {audience.data ? (
            <>
              <div style={{ padding: '12px 16px 0' }}>
                <StatStrip
                  stats={[
                    { label: 'Patients matched', value: audience.data.count },
                    {
                      label: 'Reachable',
                      value: audience.data.patients.filter((patient) => patient.phone).length,
                      hint: 'A patient with no phone number is not in the list',
                    },
                  ]}
                />
                {audience.data.truncated ? (
                  <AdminNotice tone="warn">
                    The list was capped. Narrow the criteria rather than working from a partial audience.
                  </AdminNotice>
                ) : null}
              </div>
              <DataTable
                rows={audience.data.patients}
                loading={audience.isLoading}
                rowKey="patientId"
                exportName="marketing-audience"
                searchFields={['name' as never, 'phone' as never]}
                searchPlaceholder="Search patient…"
                emptyText="No patients match these criteria"
                scrollY={380}
                columns={[
                  { title: 'Patient', dataIndex: 'name', key: 'name' },
                  { title: 'Phone', dataIndex: 'phone', key: 'phone' },
                  { title: 'Age', dataIndex: 'age', key: 'age', className: 'kw-num', render: (v: number | null) => v ?? '—' },
                  { title: 'Gender', dataIndex: 'gender', key: 'gender', optional: true },
                  {
                    title: 'Last visit',
                    dataIndex: 'lastVisitAt',
                    key: 'lastVisitAt',
                    render: (value: string | null) => (value ? dayjs(value).format('D MMM YY') : <span className="kw-muted">never</span>),
                  },
                ]}
              />
            </>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--kw-text-muted)', fontSize: 12.5 }}>
              Set the criteria and build an audience.
            </div>
          )}
        </AdminSection>

        <AdminSection title="Criteria">
          <div className="kw-filterStack">
            <label>
              <span>Programme</span>
              <Select
                allowClear
                size="small"
                placeholder="Any"
                style={{ width: '100%' }}
                options={programmes.data?.map((programme) => ({ value: programme.id, label: programme.name }))}
                onChange={(value) => setCriteria((current) => ({ ...current, programmeId: value }))}
              />
            </label>
            <label>
              <span>Seen within (days)</span>
              <InputNumber
                size="small"
                min={1}
                style={{ width: '100%' }}
                placeholder="Any"
                onChange={(value) => setCriteria((current) => ({ ...current, visitedSinceDays: value ?? undefined }))}
              />
            </label>
            <label>
              <span>Lapsed for at least (days)</span>
              <InputNumber
                size="small"
                min={1}
                style={{ width: '100%' }}
                placeholder="Any"
                onChange={(value) => setCriteria((current) => ({ ...current, lapsedForDays: value ?? undefined }))}
              />
            </label>
            <div className="kw-filterRow">
              <label>
                <span>Min age</span>
                <InputNumber size="small" min={0} max={120} style={{ width: '100%' }} onChange={(value) => setCriteria((c) => ({ ...c, minAge: value ?? undefined }))} />
              </label>
              <label>
                <span>Max age</span>
                <InputNumber size="small" min={0} max={120} style={{ width: '100%' }} onChange={(value) => setCriteria((c) => ({ ...c, maxAge: value ?? undefined }))} />
              </label>
            </div>
            <Button size="small" type="primary" block onClick={() => setBuilt(true)} loading={audience.isFetching}>
              Build audience
            </Button>
          </div>
        </AdminSection>
      </div>

      {audience.data && audience.data.count > 0 ? (
        <AdminSection
          title="Prepare messages"
          description="Renders the template for each patient in the audience and gives you a queue to work through by hand."
          actions={
            <Button
              size="small"
              type="primary"
              disabled={!mayPrepare || !templateId}
              loading={prepare.isPending}
              onClick={() => {
                if (!templateId) return;
                prepare.mutate(
                  {
                    templateId,
                    // Patients with no phone number are skipped SERVER-side and
                    // counted back, so the queue never contains a row that
                    // cannot be actioned.
                    patientIds: audience.data.patients.slice(0, 200).map((patient) => patient.patientId),
                    clinicId,
                    audienceName: audienceName || undefined,
                  },
                  {
                    onSuccess: (result) => {
                      setQueue(result);
                      setOpened({});
                    },
                    onError: (error: unknown) => message.error((error as Error).message),
                  },
                );
              }}
            >
              Prepare {Math.min(audience.data.count, 200)} message(s)
            </Button>
          }
        >
          <div className="kw-filterRow">
            <label>
              <span>Template</span>
              <Select
                size="small"
                placeholder="Choose a template"
                style={{ width: '100%' }}
                value={templateId}
                onChange={setTemplateId}
                options={templates.data
                  ?.filter((template) => template.active)
                  .map((template) => ({ value: template.id, label: `${template.name} · ${template.category}` }))}
              />
            </label>
            <label>
              <span>Name this audience (optional)</span>
              <Input
                size="small"
                placeholder="e.g. Lapsed diabetics, August"
                value={audienceName}
                onChange={(event) => setAudienceName(event.target.value)}
              />
            </label>
          </div>
          {audience.data.count > 200 ? (
            <AdminNotice tone="warn">
              This audience is {audience.data.count} patients and only the first 200 will be prepared. Two hundred
              messages a person has to send by hand is already a day's work; a thousand is not a workflow.
            </AdminNotice>
          ) : null}
          {mayPrepare ? null : (
            <AdminNotice tone="warn">You do not have permission to prepare messages.</AdminNotice>
          )}
        </AdminSection>
      ) : null}

      <Modal
        open={queue !== null}
        onCancel={() => setQueue(null)}
        width={860}
        title={`Sending queue — ${queue?.templateName ?? ''}`}
        footer={<Button onClick={() => setQueue(null)}>Close</Button>}
      >
        <AdminNotice tone="warn">{queue?.notice}</AdminNotice>
        {queue && queue.skippedWithoutPhone > 0 ? (
          <AdminNotice>
            {queue.skippedWithoutPhone} patient(s) were skipped because no phone number is on record.
          </AdminNotice>
        ) : null}
        <DataTable
          rows={queue?.messages}
          rowKey="dispatchId"
          emptyText="Nothing prepared"
          scrollY={420}
          columns={[
            { title: 'Patient', dataIndex: 'name', key: 'name' },
            { title: 'Phone', dataIndex: 'phone', key: 'phone' },
            { title: 'Message', dataIndex: 'body', key: 'body', ellipsis: true },
            {
              title: '',
              key: 'open',
              noExport: true,
              render: (_: unknown, row) =>
                opened[row.dispatchId] ? (
                  <Tag color="blue">Opened</Tag>
                ) : (
                  <Button
                    size="small"
                    type="link"
                    href={row.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      // Recorded on the CLICK, which is the last thing this
                      // system witnesses. Whether the staff member then pressed
                      // send, and whether it arrived, are not ours to claim.
                      setOpened((current) => ({ ...current, [row.dispatchId]: true }));
                      markOpened.mutate(row.dispatchId);
                    }}
                  >
                    Open in WhatsApp
                  </Button>
                ),
            },
          ]}
        />
      </Modal>

      <AdminSection title="Message templates" padded={false}>
        <DataTable
          rows={templates.data}
          loading={templates.isLoading}
          rowKey="id"
          emptyText="No templates yet"
          emptyHint="A template's {{name}}, {{firstName}} and {{clinic}} placeholders are filled per patient when a message is prepared."
          columns={[
            { title: 'Name', dataIndex: 'name', key: 'name' },
            { title: 'Category', dataIndex: 'category', key: 'category' },
            { title: 'Body', dataIndex: 'body', key: 'body', ellipsis: true },
            {
              title: 'Placeholders',
              dataIndex: 'placeholders',
              key: 'placeholders',
              render: (values: string[]) => values.map((value) => <Tag key={value}>{`{{${value}}}`}</Tag>),
            },
            {
              title: 'Active',
              dataIndex: 'active',
              key: 'active',
              render: (value: boolean) => (value ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
            },
          ]}
        />
      </AdminSection>

      <AdminSection title="What has been prepared" description={history.data?.notice} padded={false}>
        <DataTable
          rows={history.data?.rows}
          loading={history.isLoading}
          rowKey="id"
          exportName="marketing-history"
          searchFields={['patientName' as never, 'templateName' as never]}
          emptyText="Nothing prepared yet"
          columns={[
            { title: 'When', dataIndex: 'at', key: 'at', render: (value: string) => dayjs(value).format('D MMM YY, HH:mm') },
            { title: 'Patient', dataIndex: 'patientName', key: 'patientName' },
            { title: 'Template', dataIndex: 'templateName', key: 'templateName' },
            { title: 'Audience', dataIndex: 'audienceName', key: 'audienceName', optional: true },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => (
                <Tag color={value === 'OPENED' ? 'blue' : 'default'}>
                  {value === 'OPENED' ? 'Opened in WhatsApp' : 'Prepared'}
                </Tag>
              ),
            },
            { title: 'Prepared by', dataIndex: 'preparedBy', key: 'preparedBy' },
            { title: 'Message', dataIndex: 'body', key: 'body', ellipsis: true, optional: true },
          ]}
        />
      </AdminSection>

      {/* THE REST OF THE OUTBOUND CAPABILITY, and where it actually lives.
          Named here rather than rebuilt here: a second template store or a
          second booking link is exactly the duplication this consolidation is
          meant to remove. What this section fixes is that somebody in Admin
          could not tell the pieces existed. */}
      <AdminSection title="The rest of patient outreach" description="These are separate screens, not missing ones.">
        <ul className="kw-adminList">
          <li>
            <strong>Appointment reminders and their timing</strong> — Appointments ▸ Communication. One template store
            for reminders and confirmations, with the same "prepared, not sent" rule as this page.
          </li>
          <li>
            <strong>The public booking link, QR code and printable poster</strong> — Appointments ▸ Booking Page. That
            is the shareable material a patient receives; it is generated from the branch's own slug.
          </li>
          <li>
            <strong>Programme cohorts</strong> — Operation ▸ Programmes. Enrolment is what the programme criterion on
            this page filters by.
          </li>
        </ul>
      </AdminSection>
    </AdminShell>
  );
}
