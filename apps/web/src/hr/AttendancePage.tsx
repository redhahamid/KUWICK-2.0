import { useState } from 'react';
import { DatePicker, Space, Table, Typography } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useAttendance } from './hooks/useAttendance';
import { AttendanceRecord } from './types';
import { PageHeader } from '../design-system/components/PageHeader';

const { RangePicker } = DatePicker;

// HR, Phase 1c. Read-only — derived from Visit.checkInAt/checkOutAt
// (PRODUCT_REQUIREMENTS.md §4: "attendance via clinical check-in/out"),
// not a separate clock-in system, since there's no staff login yet (D-017).
export function AttendancePage() {
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().subtract(7, 'day'), dayjs()]);
  const { data: records, isLoading } = useAttendance({
    from: range?.[0]?.format('YYYY-MM-DD'),
    to: range?.[1]?.format('YYYY-MM-DD'),
  });

  return (
    <div style={{ paddingTop: 24, paddingBottom: 24 }}>
      <PageHeader
        title="Attendance"
        extra={
          <>
            <RangePicker value={range} onChange={(dates) => setRange(dates as [Dayjs, Dayjs] | null)} />
          </>
        }
      />
      <Table
        rowKey={(r: AttendanceRecord) => `${r.staffId}-${r.date}`}
        loading={isLoading}
        dataSource={records}
        locale={{ emptyText: 'No visits with a check-in in this range yet' }}
        columns={[
          { title: 'Date', dataIndex: 'date' },
          { title: 'Staff', dataIndex: 'staffName' },
          { title: 'First Check-In', render: (_: unknown, r: AttendanceRecord) => dayjs(r.firstCheckIn).format('HH:mm') },
          {
            title: 'Last Check-Out',
            render: (_: unknown, r: AttendanceRecord) => (r.lastCheckOut ? dayjs(r.lastCheckOut).format('HH:mm') : '—'),
          },
          { title: 'Visits', dataIndex: 'visitCount' },
        ]}
      />
    </div>
  );
}
