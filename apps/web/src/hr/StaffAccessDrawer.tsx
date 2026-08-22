import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Drawer,
  Input,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ApiError, apiClient } from '../core/api-client';
import { formatClinicDate } from '../clinical/clinicTime';

const { Text, Paragraph } = Typography;

interface AccessDoc {
  staffId: string;
  fullName: string;
  legacyRole: string;
  canHoldDoctorRole: boolean;
  roles: string[];
  customRoles: { id: string; name: string }[];
  grants: { permission: string; reason: string; grantedAt: string; grantedBy: { fullName: string } }[];
  effectivePermissions: string[];
  individuallyGrantable: string[];
}

interface CustomRoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
}

const ROLE_WORDS: Record<string, { label: string; detail: string }> = {
  OWNER: {
    label: 'Owner',
    detail: 'Settings, users and roles, billing corrections — never clinical authority by itself.',
  },
  ADMINISTRATOR: {
    label: 'Administrator (front counter)',
    detail: 'Registration, queue, counter billing, the whole appointment diary.',
  },
  CLINICAL_STAFF: {
    label: 'Clinical staff (nurse)',
    detail: 'Observations, allergies, staff remarks, dispensing, the diary.',
  },
  DOCTOR: {
    label: 'Doctor',
    detail: 'The clinical record. Needs a medical registration number on the profile.',
  },
};

/**
 * FINAL-UAT — one person, many roles.
 *
 * The audit found multi-role ALREADY existed end-to-end (assignment table,
 * union resolution, session payload) with no way to manage it outside a seed
 * script. This drawer is that management surface: capability roles, custom
 * roles and individual grants together, with the server's own effective
 * permission list shown back — the browser renders what the server decided,
 * never a second derivation.
 */
export function StaffAccessDrawer({
  staffId,
  staffName,
  onClose,
}: {
  staffId: string | null;
  staffName?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: access, isLoading } = useQuery({
    queryKey: ['staff-access', staffId],
    queryFn: () => apiClient.get<AccessDoc>(`/staff-access/${staffId}`),
    enabled: Boolean(staffId),
  });
  const { data: customRoles } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => apiClient.get<CustomRoleRow[]>('/staff-access/custom-roles'),
    enabled: Boolean(staffId),
  });

  const [roles, setRoles] = useState<string[]>([]);
  const [customRoleIds, setCustomRoleIds] = useState<string[]>([]);
  const [seededFor, setSeededFor] = useState<string>();
  const [grantPermission, setGrantPermission] = useState<string>();
  const [grantReason, setGrantReason] = useState('');

  useEffect(() => {
    if (!access || seededFor === access.staffId) return;
    setSeededFor(access.staffId);
    setRoles(access.roles);
    setCustomRoleIds(access.customRoles.map((role) => role.id));
    setGrantPermission(undefined);
    setGrantReason('');
  }, [access, seededFor]);

  const saveRoles = useMutation({
    mutationFn: () =>
      apiClient.put(`/staff-access/${staffId}/roles`, { roles, customRoleIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-access', staffId] });
      message.success('Access updated. It applies from their next sign-in.');
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : 'Could not update access.'),
  });

  const addGrant = useMutation({
    mutationFn: () =>
      apiClient.post(`/staff-access/${staffId}/grants`, {
        permission: grantPermission,
        reason: grantReason.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-access', staffId] });
      setGrantPermission(undefined);
      setGrantReason('');
      message.success('Granted — recorded with your name and the reason.');
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : 'Could not add the grant.'),
  });

  return (
    <Drawer
      open={Boolean(staffId)}
      onClose={onClose}
      width={480}
      title={`Access — ${access?.fullName ?? staffName ?? ''}`}
      destroyOnHidden
      data-testid="staff-access-drawer"
    >
      {isLoading || !access ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Job title (HR record)
            </Text>
            <div>
              <Tag>{access.legacyRole.replace(/_/g, ' ')}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                The job title only decides access while no roles below are ticked.
              </Text>
            </div>
          </div>

          <div>
            <Text strong>Capability roles</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              One person can hold several — Dr Redha can be Owner, Doctor and Administrator at
              once. What they can do is the UNION of everything ticked.
            </Paragraph>
            <Space direction="vertical" size={6}>
              {Object.entries(ROLE_WORDS).map(([value, words]) => {
                const doctorBlocked = value === 'DOCTOR' && !access.canHoldDoctorRole;
                return (
                  <Tooltip
                    key={value}
                    title={
                      doctorBlocked
                        ? 'Needs a medical registration number on the staff profile first.'
                        : undefined
                    }
                  >
                    <Checkbox
                      checked={roles.includes(value)}
                      disabled={doctorBlocked}
                      onChange={(event) =>
                        setRoles((previous) =>
                          event.target.checked
                            ? [...previous, value]
                            : previous.filter((role) => role !== value),
                        )
                      }
                    >
                      <Text strong>{words.label}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {words.detail}
                      </Text>
                    </Checkbox>
                  </Tooltip>
                );
              })}
            </Space>
          </div>

          <div>
            <Text strong>Custom roles</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              The bundles you defined under Clinic Settings → Roles &amp; Permissions.
            </Paragraph>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="None"
              value={customRoleIds}
              onChange={setCustomRoleIds}
              options={(customRoles ?? []).map((role) => ({ value: role.id, label: role.name }))}
            />
          </div>

          <Button
            type="primary"
            loading={saveRoles.isPending}
            onClick={() => saveRoles.mutate()}
            data-testid="save-access"
          >
            Save access
          </Button>

          <div>
            <Text strong>Individual grants</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              A single power for one trusted person, additive only, with a recorded reason. To
              take a capability away, change the roles above.
            </Paragraph>
            {access.grants.length > 0 ? (
              <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 8 }}>
                {access.grants.map((grant) => (
                  <div key={grant.permission}>
                    <Tag color="blue">{grant.permission}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {grant.reason} — {grant.grantedBy.fullName},{' '}
                      {formatClinicDate(grant.grantedAt)}
                    </Text>
                  </div>
                ))}
              </Space>
            ) : null}
            <Space.Compact style={{ width: '100%' }}>
              <Select
                placeholder="Permission…"
                style={{ width: 220 }}
                value={grantPermission}
                onChange={setGrantPermission}
                options={access.individuallyGrantable.map((permission) => ({
                  value: permission,
                  label: permission,
                }))}
              />
              <Input
                placeholder="Why this person (required)"
                value={grantReason}
                onChange={(event) => setGrantReason(event.target.value)}
              />
              <Button
                loading={addGrant.isPending}
                disabled={!grantPermission || grantReason.trim().length < 3}
                onClick={() => addGrant.mutate()}
              >
                Grant
              </Button>
            </Space.Compact>
          </div>

          <Collapse
            ghost
            items={[
              {
                key: 'effective',
                label: `Effective permissions (${access.effectivePermissions.length}) — the server's own answer`,
                children: (
                  <Space size={[4, 6]} wrap>
                    {access.effectivePermissions.map((permission) => (
                      <Tag key={permission} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {permission}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
            ]}
          />

          <Alert
            type="info"
            showIcon
            message="Changes apply at next sign-in"
            description="Access is enforced by the server on every action immediately; the menus a signed-in person sees refresh when they next sign in."
          />
        </Space>
      )}
    </Drawer>
  );
}
