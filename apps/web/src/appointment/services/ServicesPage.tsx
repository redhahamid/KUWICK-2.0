import { useState } from 'react';
import { Button, Empty, Input, Segmented, Space, Table, Tooltip, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { useAppointmentServices, type ServiceListRow } from '../hooks/useServiceConfig';
import { ServiceEditorDrawer } from './ServiceEditorDrawer';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { useProviderColors, type ProviderColorResolver } from '../hooks/useProviderColors';

const { Text } = Typography;

function providerChip(
  provider: { id: string; fullName: string },
  providerColor: ProviderColorResolver,
) {
  const short = provider.fullName.replace(/^Dr\.?\s*/i, '');
  return (
    <span key={provider.id} className="kw-svc-provider-chip">
      <span
        className="kw-svc-provider-dot"
        style={{ background: providerColor(provider.id).accent }}
        aria-hidden
      >
        {short
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0] ?? '')
          .join('')
          .toUpperCase()}
      </span>
      {short.split(/\s+/).slice(0, 2).join(' ')}
    </span>
  );
}

interface ServicesPageProps {
  clinicId?: string;
}

/**
 * SERVICES (§20) — the existing catalogue, with its booking terms.
 *
 * There is no separate appointment-only service list. A clinic that renames a
 * service, or retires one, must not find the public booking page still
 * advertising the old name — and a second table is exactly how that happens.
 *
 * The two retired settings pages live inside the editor here:
 * DOCTOR-SERVICE MAPPING became the Providers tab, and SLOT CAPACITY became a
 * field on the Scheduling tab. Both junction tables are untouched; only the
 * question's shape changed, from "which of these hundred pairs are true" to
 * "who can do this one thing".
 */
export function ServicesPage({ clinicId }: ServicesPageProps) {
  const providerColor = useProviderColors();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'bookable' | 'all'>('bookable');
  const [editing, setEditing] = useState<string | null>(null);
  // Booking configuration is a policy action (appointment.configure). The
  // catalogue stays readable; the doors into changing it disable and say why.
  const canConfigure = useCan('appointment.configure');

  const { data, isFetching } = useAppointmentServices({
    bookableOnly: scope === 'bookable',
    search: search.trim() || undefined,
  });

  return (
    <div className="kw-services-page" data-testid="services-page">
      <div className="kw-svc-head">
        <div>
          <p className="kw-svc-title">Online booking settings</p>
          <p className="kw-svc-sub">
            Which services patients can book, and how their slots are generated. The services
            themselves — name, code, category, price — are defined once in{' '}
            <a onClick={() => navigate('/settings/clinical/services')}>
              Settings ▸ Clinical ▸ Services &amp; Procedures
            </a>
            .
          </p>
        </div>
        {/* Creation lives in the clinic's ONE catalogue — this is a door to
            it, not a second list that could drift from it. */}
        <Tooltip title="Opens the clinic's service catalogue — services created there appear here.">
          <Button
            icon={<PlusOutlined />}
            disabled={!canConfigure}
            title={canConfigure ? undefined : permissionHint('change how appointments and services are configured')}
            onClick={() => navigate('/settings/clinical/services')}
          >
            Create service in catalogue
          </Button>
        </Tooltip>
      </div>

      <div className="kw-appt-controls">
        <Segmented
          value={scope}
          onChange={(value) => setScope(value as 'bookable' | 'all')}
          options={[
            { value: 'bookable', label: 'Bookable' },
            { value: 'all', label: 'Whole catalogue' },
          ]}
        />
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Find a service"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 240 }}
          />
        </Space>
      </div>

      {scope === 'all' ? (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Most of the catalogue is not bookable, and should not be: a chest X-ray is an order a
          doctor places, not a slot a patient picks. Open one to turn booking on.
        </Text>
      ) : null}

      <Table<ServiceListRow>
        rowKey="id"
        loading={isFetching}
        dataSource={data ?? []}
        onRow={(row) => ({ onClick: () => canConfigure && setEditing(row.id), style: { cursor: canConfigure ? 'pointer' : 'default' } })}
        pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                scope === 'bookable'
                  ? 'No service is set up for booking yet. Switch to the whole catalogue and open one.'
                  : 'No service matches that.'
              }
            />
          ),
        }}
        columns={[
          {
            title: 'Service',
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <span className="kw-svc-name">{row.name}</span>
                {row.category ? <span className="kw-svc-cat">{row.category}</span> : null}
              </Space>
            ),
          },
          {
            title: 'Duration',
            width: 110,
            render: (_, row) => `${row.durationMinutesDefault} min`,
          },
          {
            title: 'Starts every',
            width: 120,
            render: (_, row) =>
              row.slotIntervalMinutes ? (
                `${row.slotIntervalMinutes} min`
              ) : (
                <Tooltip title="Back to back — the next slot starts when this one ends.">
                  <Text type="secondary">Back to back</Text>
                </Tooltip>
              ),
          },
          {
            title: 'Buffers',
            width: 110,
            render: (_, row) =>
              row.bufferBeforeMinutes || row.bufferAfterMinutes ? (
                <Text>
                  {row.bufferBeforeMinutes}/{row.bufferAfterMinutes} min
                </Text>
              ) : (
                <Text type="secondary">None</Text>
              ),
          },
          {
            title: 'Providers',
            render: (_, row) =>
              row.providers.length === 0 ? (
                <Tooltip title="Nobody is assigned to perform this, so patients cannot book it. Edit the service and assign a provider.">
                  <KuwickStatusTag tone="error" label="Nobody" />
                </Tooltip>
              ) : (
                <Space size={4} wrap>
                  {row.providers.slice(0, 3).map((provider) => providerChip(provider, providerColor))}
                  {row.providers.length > 3 ? (
                    <span className="kw-svc-provider-chip">+{row.providers.length - 3}</span>
                  ) : null}
                </Space>
              ),
          },
          {
            title: 'Price',
            width: 130,
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <span className="kw-svc-price">RM {Number(row.price).toFixed(2)}</span>
                <span className="kw-svc-price-mode">
                  {row.priceDisplay === 'HIDDEN'
                    ? 'Hidden publicly'
                    : row.priceDisplay === 'FROM'
                      ? 'Shown as “from”'
                      : 'Shown exactly'}
                </span>
              </Space>
            ),
          },
          {
            title: 'Confirmation',
            width: 130,
            render: (_, row) =>
              row.requiresApproval ? (
                <KuwickStatusTag tone="attention" label="Needs approval" />
              ) : (
                <KuwickStatusTag tone="success" label="Auto-confirm" />
              ),
          },
          {
            title: 'Online',
            width: 150,
            // The FLAG says "booking enabled"; this column says whether a
            // patient can actually book it. A service with no active
            // provider can never produce a slot, so the public page hides it
            // — and this cell says so, with the fix, instead of a green
            // "Bookable" that is not true.
            render: (_, row) =>
              !row.bookable ? (
                <KuwickStatusTag tone="neutral" label="Off" />
              ) : !row.active ? (
                <Tooltip title="Retired services are never shown to patients, whatever the booking flag says.">
                  <KuwickStatusTag tone="neutral" label="Retired — hidden" />
                </Tooltip>
              ) : row.providers.length === 0 ? (
                <Tooltip title="Booking is enabled but nobody is assigned to perform it, so patients cannot see it yet. Edit the service and assign a provider.">
                  <KuwickStatusTag tone="attention" label="Setup incomplete" />
                </Tooltip>
              ) : (
                <KuwickStatusTag tone="success" label="Bookable" />
              ),
          },
          {
            title: '',
            width: 80,
            render: (_, row) => (
              <Button
                size="small"
                disabled={!canConfigure}
                title={canConfigure ? undefined : permissionHint('change how appointments and services are configured')}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditing(row.id);
                }}
              >
                Edit
              </Button>
            ),
          },
        ]}
      />

      <ServiceEditorDrawer
        serviceId={editing}
        clinicId={clinicId}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
