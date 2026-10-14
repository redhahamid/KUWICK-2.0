import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Input, Modal, Select } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../core/api-client';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { qrSvg } from '../../appointment/booking-page/qr';

interface KioskState {
  clinicId: string;
  clinicName: string | null;
  periodSeconds: number;
  code: string;
  expiresAt: string;
  pinPeople: { staffId: string; name: string }[];
}

/**
 * THE CLINIC'S ATTENDANCE SCREEN (UAT, 14 October 2026): "Kiosk screen per
 * branch showing a QR that changes every 30 s; staff and doctors scan with
 * their own phone." A tablet at the entrance, signed in by somebody who
 * manages attendance, opened at /kiosk/attendance?clinicId=…
 *
 * The code comes from the server, signed, and is fetched again as it
 * expires. "Use PIN" is the fallback for a phone that cannot scan; HR sees
 * every PIN clock-in.
 */
export function AttendanceKioskPage() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const { clinics } = useClinicFilter();
  const clinicId = params.get('clinicId') ?? undefined;
  const [now, setNow] = useState(() => Date.now());
  const [pinOpen, setPinOpen] = useState(false);
  const [who, setWho] = useState<string | undefined>();
  const [pin, setPin] = useState('');

  const kiosk = useQuery({
    queryKey: ['attendance-kiosk', clinicId],
    queryFn: () => apiClient.get<KioskState>(`/workforce/attendance/kiosk?clinicId=${clinicId}`),
    enabled: Boolean(clinicId),
    // Fetched again a second after each code expires, and every 5 s as a backstop.
    refetchInterval: (query) => {
      const expires = query.state.data ? new Date(query.state.data.expiresAt).getTime() : 0;
      return Math.max(1000, Math.min(5000, expires - Date.now() + 1000));
    },
  });
  const byPin = useMutation({
    mutationFn: (body: { clinicId: string; staffId: string; pin: string }) => apiClient.post('/workforce/attendance/kiosk/pin', body),
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!clinicId) {
    return (
      <div className="kw-kiosk">
        <h1>Attendance screen</h1>
        <p>Choose the branch this screen stands in.</p>
        <Select
          aria-label="Branch"
          style={{ width: 320 }}
          options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          onChange={(id: string) => setParams({ clinicId: id })}
        />
      </div>
    );
  }

  const data = kiosk.data;
  const svg = data ? qrSvg(data.code, 360) : null;
  const left = data ? Math.max(0, Math.ceil((new Date(data.expiresAt).getTime() - now) / 1000)) : 0;

  return (
    <div className="kw-kiosk">
      <h1>{data?.clinicName ?? 'Attendance'}</h1>
      <p>Scan with My Kuwick to clock in or out.</p>
      {kiosk.isError ? <div className="hr-notice hr-notice--attn">{kiosk.error instanceof Error ? kiosk.error.message : 'The code could not be loaded.'}</div> : null}
      {svg ? <div className="kw-kiosk__code" aria-label="Attendance code" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      {data ? <p className="kw-kiosk__timer">New code in {left} s</p> : null}
      <button type="button" className="hr-btn" onClick={() => setPinOpen(true)} disabled={!data?.pinPeople.length}>
        Use PIN instead
      </button>

      <Modal
        open={pinOpen}
        title="Clock in or out with your PIN"
        okText="Record"
        confirmLoading={byPin.isPending}
        onCancel={() => setPinOpen(false)}
        onOk={async () => {
          if (!who || !pin) return;
          try {
            await byPin.mutateAsync({ clinicId, staffId: who, pin });
            message.success(`Recorded for ${data?.pinPeople.find((row) => row.staffId === who)?.name ?? 'you'}.`);
            setPin('');
            setWho(undefined);
            setPinOpen(false);
          } catch (error) {
            message.error(error instanceof ApiError ? error.message : 'Not recorded.');
          }
        }}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Select
            aria-label="Your name"
            showSearch={{ optionFilterProp: 'label' }}
            placeholder="Your name"
            value={who}
            onChange={setWho}
            options={(data?.pinPeople ?? []).map((row) => ({ value: row.staffId, label: row.name }))}
          />
          <Input.Password aria-label="PIN" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />
        </div>
      </Modal>
    </div>
  );
}
