import { Button, Empty, Popconfirm, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AppointmentStatus } from '@kuwick/shared';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { formatClinicDate, formatClinicTime } from '../../clinical/clinicTime';
import { ApiError } from '../../core/api-client';
import {
  ARRIVABLE_FROM_STATUSES,
  NON_CANCELLABLE_STATUSES,
} from '../appointment-status.constants';
import {
  useArrivedAppointment,
  useCancelAppointment,
  useNoShowAppointment,
} from '../hooks/useAppointments';
import { Appointment } from '../types';

const STATUS_TONE: Record<string, 'success' | 'active' | 'attention' | 'error' | 'neutral'> = {
  CONFIRMED: 'active',
  REMINDED: 'active',
  ARRIVED: 'success',
  IN_QUEUE: 'success',
  COMPLETED: 'success',
  REQUESTED: 'attention',
  NO_SHOW: 'error',
  CANCELLED: 'neutral',
  RESCHEDULED: 'neutral',
};

/**
 * The right-hand panel: what this appointment IS, and what can be done to it.
 *
 * A PANEL, not the popover it replaces. A popover closes when you look away,
 * which is wrong for the thing you are working from — the front desk reads the
 * patient's name while typing it into a phone call, and reads the notes while
 * the patient is at the counter.
 *
 * Every action is the same mutation the list rows use, so the calendar and the
 * dashboard cannot disagree about what "arrived" does.
 */
export function AppointmentDetailPanel({
  appointment,
  patientName,
  staffName,
  serviceName,
  onReschedule,
  onMove,
  onChanged,
  onClose,
}: {
  appointment: Appointment | null;
  patientName: string;
  staffName: string;
  serviceName: string;
  onReschedule: (appointment: Appointment) => void;
  /** Pick this appointment up to place it on another slot. */
  onMove?: (appointment: Appointment) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const arrived = useArrivedAppointment();
  const noShow = useNoShowAppointment();
  const cancel = useCancelAppointment();

  if (!appointment) {
    return (
      <aside className="kw-cal-panel kw-cal-panel-empty" aria-label="Appointment detail">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Select an appointment to see its detail"
        />
      </aside>
    );
  }

  const status = appointment.status as AppointmentStatus;
  const act = async (run: Promise<unknown>, failure: string) => {
    try {
      await run;
      onChanged();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : failure);
    }
  };

  return (
    <aside className="kw-cal-panel" aria-label="Appointment detail" data-testid="appointment-detail-panel">
      <header className="kw-cal-panel-head">
        <div>
          <Typography.Title level={5} className="kw-cal-panel-name">
            {patientName}
          </Typography.Title>
          <KuwickStatusTag
            tone={STATUS_TONE[status] ?? 'neutral'}
            label={String(status).replace(/_/g, ' ').toLowerCase()}
          />
        </div>
        <Button type="text" onClick={onClose} aria-label="Close detail">
          ×
        </Button>
      </header>

      <dl className="kw-cal-panel-facts">
        <div>
          <dt>When</dt>
          <dd>
            {formatClinicDate(appointment.scheduledStart)} ·{' '}
            {formatClinicTime(appointment.scheduledStart)}–{formatClinicTime(appointment.scheduledEnd)}
          </dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd>{serviceName}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{staffName}</dd>
        </div>
        {appointment.notes && (
          <div>
            <dt>Notes</dt>
            <dd className="kw-cal-panel-notes">{appointment.notes}</dd>
          </div>
        )}
        {appointment.cancelReason && (
          <div>
            <dt>Cancelled because</dt>
            <dd>{appointment.cancelReason}</dd>
          </div>
        )}
      </dl>

      <div className="kw-cal-panel-actions">
        {ARRIVABLE_FROM_STATUSES.includes(status) && (
          <Button
            type="primary"
            block
            loading={arrived.isPending}
            onClick={() =>
              act(arrived.mutateAsync({ id: appointment.id }), 'Could not mark them arrived.')
            }
          >
            Arrived
          </Button>
        )}
        {!NON_CANCELLABLE_STATUSES.includes(status) && onMove && (
          // MOVE puts the calendar into place-it mode; RESCHEDULE opens the
          // drawer's slot list. Two ways to the same endpoint, because they
          // answer different questions: "put it there" and "when is free?".
          <Button block onClick={() => onMove(appointment)}>
            Move to another time
          </Button>
        )}
        {!NON_CANCELLABLE_STATUSES.includes(status) && (
          <Button block onClick={() => onReschedule(appointment)}>
            Reschedule
          </Button>
        )}
        {ARRIVABLE_FROM_STATUSES.includes(status) && (
          <Button
            block
            onClick={() => act(noShow.mutateAsync({ id: appointment.id }), 'Could not mark no-show.')}
          >
            No-show
          </Button>
        )}
        {!NON_CANCELLABLE_STATUSES.includes(status) && (
          <Popconfirm
            title="Cancel this appointment?"
            description="The patient keeps their place until you confirm."
            onConfirm={() =>
              act(cancel.mutateAsync({ id: appointment.id }), 'Could not cancel it.')
            }
          >
            <Button block danger>
              Cancel
            </Button>
          </Popconfirm>
        )}

        {/*
          OPEN RECORD goes to the VISIT this appointment became, not to the
          patient's most recent one — which is the wrong visit the moment a
          patient has two. `visitId` is written when they arrive; before that
          there is no record to open and the button says so by being absent.
        */}
        {appointment.visitId ? (
          <Button
            block
            type="link"
            onClick={() => navigate(`/patients/${appointment.patientId}?visitId=${appointment.visitId}`)}
          >
            Open record
          </Button>
        ) : (
          <Button block type="link" onClick={() => navigate(`/patients/${appointment.patientId}`)}>
            Open patient
          </Button>
        )}
      </div>
    </aside>
  );
}
