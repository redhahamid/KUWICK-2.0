import { useState } from 'react';
import { Button, Form, Input, message, Modal, Select, Space, Switch, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useCreateRoom, useRooms, useUpdateRoom } from './hooks/useQueueTickets';
import { Room } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

const { Text } = Typography;

// D-038 — rooms/stations patients get called to (Consultation 1/2,
// Treatment Room 1/2, Dispensary Counter). Management > Operation.
export function RoomsPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const { data: rooms, isLoading } = useRooms(clinicId);
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ name: string }>();

  const handleCreate = async ({ name }: { name: string }) => {
    if (!clinicId) return;
    try {
      await createRoom.mutateAsync({ clinicId, name });
      message.success('Room added');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add room');
    }
  };

  return (
    <>
      <PageHeader
        title="Rooms & Stations"
        extra={
          <>
            <Space>
          {showSelector && (
            <Select
              placeholder="Select clinic"
              style={{ width: 220 }}
              value={clinicId}
              onChange={setClinicId}
              options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            />
          )}
          <Button type="primary" icon={<PlusOutlined />} disabled={!clinicId} onClick={() => setOpen(true)}>
            Add Room
          </Button>
        </Space>
          </>
        }
      />
      {!clinicId ? (
        <Text type="secondary">Select a clinic to manage its rooms.</Text>
      ) : (
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={rooms}
          columns={[
            { title: 'Name', dataIndex: 'name' },
            {
              title: 'Active',
              width: 100,
              render: (_: unknown, room: Room) => (
                <Switch
                  checked={room.active}
                  onChange={(checked) =>
                    updateRoom
                      .mutateAsync({ id: room.id, dto: { active: checked } })
                      .catch((error) =>
                        message.error(error instanceof ApiError ? error.message : 'Failed to update room'),
                      )
                  }
                />
              ),
            },
          ]}
        />
      )}
      <Modal title="Add Room" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Room / Station Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Consultation 1, Treatment Room 2, Dispensary Counter" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createRoom.isPending} block>
            Add
          </Button>
        </Form>
      </Modal>
    </>
  );
}
