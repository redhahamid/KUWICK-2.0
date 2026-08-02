import { useParams } from 'react-router-dom';
import { Alert, Card, Space, Tag, Typography } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ReadOnlyVisitDetail } from './ReadOnlyVisitDetail';
import { useVisitHistoryDetail } from './useVisitHistory';
import { useIsDesktop } from '../../core/hooks/useMediaQuery';

const { Title, Text } = Typography;

/**
 * G4 (D-067) — one historical visit, on its own route.
 *
 * "Open Full Visit" targets this page in a NEW TAB. That is the whole point:
 * the consultation tab keeps its unsaved note, its current visit and its
 * scroll position, while the older visit opens beside it.
 *
 * The route is `/history/patients/:patientId/visits/:visitId` — deliberately
 * separate from `/patients/:id`, which is the editable workspace. There is no
 * read-only "mode" flag on the working route that could be lost, defaulted
 * wrongly, or forgotten by a future caller: a different URL cannot be
 * accidentally editable, and this page mounts only read-only components.
 */
export function HistoricalVisitPage() {
  const { patientId, visitId } = useParams<{ patientId: string; visitId: string }>();
  const { data, isLoading, error } = useVisitHistoryDetail(patientId, visitId);
  const isDesktop = useIsDesktop();
  const visit = data?.visit;

  return (
    <div className="kw-historical-visit">
      <Alert
        type="info"
        showIcon
        icon={<EyeOutlined />}
        style={{ marginBottom: 12 }}
        message="Historical Visit — Read Only"
        description="This is a completed visit, opened for reference. Nothing on this page can be edited, and no record is created by viewing it."
      />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={2}>
          <Space wrap size={8}>
            <Title level={4} style={{ margin: 0 }}>
              {visit?.patient?.name ?? 'Patient'}
            </Title>
            <Tag color="default">Read only</Tag>
          </Space>
          <Text type="secondary">
            {visit
              ? `Visit ${visit.visitNumber} · ${dayjs(visit.checkInAt).format('D MMM YYYY, HH:mm')}${
                  visit.clinic?.name ? ` · ${visit.clinic.name}` : ''
                }`
              : 'Loading visit…'}
          </Text>
        </Space>
      </Card>

      <ReadOnlyVisitDetail detail={data} isLoading={isLoading} error={error} compact={!isDesktop} />
    </div>
  );
}
