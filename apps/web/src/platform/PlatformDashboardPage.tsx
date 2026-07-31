import { useQuery } from '@tanstack/react-query';
import { Card, Col, Empty, List, Progress, Row, Statistic, Table, Tag, Typography } from 'antd';
import { platformApi } from './api';
import { PlatformDashboardSummary } from './types';

const { Title, Text } = Typography;

export function PlatformDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'dashboard'],
    queryFn: () => platformApi.get<PlatformDashboardSummary>('/platform/dashboard'),
  });

  const maxPlanCount = Math.max(1, ...(data?.planDistribution.map((p) => p.count) ?? [1]));

  return (
    <div>
      <Title level={4} style={{ marginBottom: 20 }}>
        Super Admin Dashboard
      </Title>
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={8}>
          <Card loading={isLoading} style={{ borderBottom: '3px solid #2f5bf6' }}>
            <Statistic title="Total Active Clinics" value={data?.totalActiveClinics ?? 0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card loading={isLoading} style={{ borderBottom: '3px solid #a855f7' }}>
            <Statistic title="Active Subscriptions" value={data?.activeSubscriptionCount ?? 0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card loading={isLoading} style={{ borderBottom: '3px solid #22c55e' }}>
            <Statistic
              title="Monthly Revenue (Est.)"
              value={data?.monthlyRevenueEstimate ?? 0}
              precision={2}
              prefix="RM"
              valueStyle={{ color: '#16a34a' }}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="Recent Clinic Signups" loading={isLoading}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.recentSignups ?? []}
              columns={[
                { title: 'Details', dataIndex: 'name' },
                {
                  title: 'Registered',
                  dataIndex: 'createdAt',
                  render: (value: string) => new Date(value).toLocaleDateString(),
                },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={<span style={{ color: '#dc2626' }}>Expiring Soon (7 Days)</span>}
            extra={<Tag color={data?.expiringSoon.length ? 'red' : 'default'}>{data?.expiringSoon.length ?? 0}</Tag>}
            loading={isLoading}
            style={{ marginBottom: 16 }}
          >
            {data?.expiringSoon.length ? (
              <List
                size="small"
                dataSource={data.expiringSoon}
                renderItem={(item) => (
                  <List.Item>
                    <Text>{item.tenantName}</Text>
                    <Text type="secondary">
                      {item.planName} — {new Date(item.endsAt).toLocaleDateString()}
                    </Text>
                  </List.Item>
                )}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No subscriptions expiring soon." />
            )}
          </Card>
          <Card title="Subscription Plan Distribution" loading={isLoading}>
            {data?.planDistribution.length ? (
              data.planDistribution.map((plan) => (
                <div key={plan.name} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text>{plan.name}</Text>
                    <Text>{plan.count}</Text>
                  </div>
                  <Progress percent={(plan.count / maxPlanCount) * 100} showInfo={false} strokeColor="#2f5bf6" />
                </div>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active subscriptions." />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
