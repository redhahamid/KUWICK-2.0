import { useState } from 'react';
import { App, Button, Input, InputNumber, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useMarketingAudience, useMarketingHistory, useMarketingTemplates, useProgrammes } from '../hooks/useAdmin';

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
    </AdminShell>
  );
}
