import { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Row, Space, Statistic, Table, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDayEndSummary } from './hooks/useReports';
import { exportCsv } from './exportCsv';

const { Title, Text } = Typography;

// D-039 — the owner's "Day end summary — closing that day": total sales,
// panel vs cash patients, cash collections by payment method, panel
// billings by panel company.
export function DayEndPage() {
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const { data, isLoading } = useDayEndSummary(date);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Day-End Closing
        </Title>
        <DatePicker allowClear={false} value={dayjs(date)} onChange={(d) => d && setDate(d.format('YYYY-MM-DD'))} />
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Total Sales" value={data?.totalSales ?? 0} precision={2} prefix="RM" />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic
              title="Cash Collected (at counter)"
              value={data?.cashCollected ?? 0}
              precision={2}
              prefix="RM"
              valueStyle={{ color: '#16a34a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic
              title="Panel Billed"
              value={data?.panelBilled ?? 0}
              precision={2}
              prefix="RM"
              valueStyle={{ color: '#2f5bf6' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic
              title="Patients (Cash / Panel)"
              value={`${data?.cashPatients ?? 0} / ${data?.panelPatients ?? 0}`}
            />
          </Card>
        </Col>
      </Row>
      {(data?.unpaidCount ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${data?.unpaidCount} invoice(s) created today are still unpaid — settle or carry them forward before closing.`}
        />
      )}
      <Row gutter={16}>
        <Col span={12}>
          <Card
            title="Cash Collections by Payment Method"
            loading={isLoading}
            extra={
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => data && exportCsv(`day-end-${date}-payment-methods`, data.byPaymentMethod)}
              >
                CSV
              </Button>
            }
          >
            <Table
              rowKey="paymentMethod"
              size="small"
              pagination={false}
              dataSource={data?.byPaymentMethod}
              columns={[
                { title: 'Method', dataIndex: 'paymentMethod' },
                { title: 'Transactions', dataIndex: 'count' },
                { title: 'Amount (RM)', render: (_: unknown, r: { amount: number }) => r.amount.toFixed(2) },
              ]}
              summary={() =>
                data && (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <Text strong>Total</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1}>
                      <Text strong>{data.byPaymentMethod.reduce((s, r) => s + r.count, 0)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2}>
                      <Text strong>{data.cashCollected.toFixed(2)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )
              }
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title="Panel Billings by Panel"
            loading={isLoading}
            extra={
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => data && exportCsv(`day-end-${date}-panels`, data.byPanel)}
              >
                CSV
              </Button>
            }
          >
            <Table
              rowKey="panelName"
              size="small"
              pagination={false}
              dataSource={data?.byPanel}
              columns={[
                { title: 'Panel', dataIndex: 'panelName' },
                { title: 'Patients', dataIndex: 'patients' },
                { title: 'Billed (RM)', render: (_: unknown, r: { amount: number }) => r.amount.toFixed(2) },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
