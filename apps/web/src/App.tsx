import { Layout, Typography, Space } from 'antd';
import { AppointmentStatus, APPOINTMENT_STATUS_TONE } from '@kuwick/shared';
import { StatusBadge } from './design-system/components/StatusBadge';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

// Placeholder shell only — proves the stack (React + Ant Design + shared
// types + design tokens) is wired together end to end. No clinical module
// screens are built yet; those start in Phase 1 per docs/DEVELOPMENT_ROADMAP.md.
export function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <Title level={4} style={{ color: 'white', margin: 0 }}>
          Kuwick 2.0
        </Title>
      </Header>
      <Content style={{ padding: 24 }}>
        <Space direction="vertical" size="large">
          <Text>Foundation initialized. Phase 1 modules are not yet built.</Text>
          <Space>
            {Object.values(AppointmentStatus).map((status) => (
              <StatusBadge
                key={status}
                label={status}
                tone={APPOINTMENT_STATUS_TONE[status]}
              />
            ))}
          </Space>
        </Space>
      </Content>
    </Layout>
  );
}
