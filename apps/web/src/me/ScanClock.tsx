import { useEffect, useRef, useState } from 'react';
import { App, Input } from 'antd';
import jsQR from 'jsqr';
import { ApiError } from '../core/api-client';
import { Drawer } from '../admin/hr/ui';
import { formatClinicTime } from '../clinical/clinicTime';
import { readPosition } from './clock';
import { useClockSelf, useSetAttendancePin } from './hooks/useMe';

/**
 * SCAN THE CLINIC CODE (UAT, 14 October 2026): "staff and doctors scan with
 * their own phone in My Kuwick." The back camera reads the code on the
 * branch kiosk; the server checks it is genuine and current, and where the
 * phone is when the clinic asks for that. Clock in or out is decided by the
 * server, as with the button.
 */
export function ScanClock({ onDuty = false }: { onDuty?: boolean }) {
  const { message } = App.useApp();
  const clock = useClockSelf();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let stream: MediaStream | null = null;
    let frame = 0;
    let done = false;
    const canvas = document.createElement('canvas');
    const look = () => {
      const video = videoRef.current;
      if (done || !video || video.readyState < 2) {
        frame = requestAnimationFrame(look);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0);
      const found = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      if (found?.data) {
        done = true;
        void send(found.data);
        return;
      }
      frame = requestAnimationFrame(look);
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((media) => {
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          void videoRef.current.play();
        }
        frame = requestAnimationFrame(look);
      })
      .catch(() => setProblem('The camera is not available. Allow the camera, or use your PIN at the clinic screen.'));
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async (qr: string) => {
    const position = await readPosition();
    try {
      await clock.mutateAsync({ qr, ...(position ?? {}) });
      // Say what happened and when, so nobody scans twice to be sure.
      message.success(`${onDuty ? 'Clocked out' : 'Clocked in'} at ${formatClinicTime(new Date().toISOString())}.`);
      setOpen(false);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'The clinic code could not be used.');
    }
  };

  return (
    <>
      <button type="button" className="hr-btn hr-btn--primary" onClick={() => { setProblem(null); setOpen(true); }}>
        {onDuty ? 'Scan to clock out' : 'Scan to clock in'}
      </button>
      <Drawer open={open} title="Scan the code on the clinic screen" onClose={() => setOpen(false)}>
        {problem ? <div className="hr-notice hr-notice--attn">{problem}</div> : null}
        <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 12, background: '#101828' }} />
        <div className="hr-sub" style={{ marginTop: 8 }}>Point the camera at the code. It changes every half minute, so scan the screen, not a photo.</div>
      </Drawer>
    </>
  );
}

/** Set or change the kiosk PIN, used at the clinic screen when the phone cannot scan. */
export function KioskPinForm() {
  const { message } = App.useApp();
  const save = useSetAttendancePin();
  const [pin, setPin] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Input.Password
        aria-label="Kiosk PIN"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        placeholder="4 to 6 digits"
        style={{ width: 160 }}
      />
      <button
        type="button"
        className="hr-btn hr-btn--sm"
        disabled={pin.length < 4 || save.isPending}
        onClick={async () => {
          try {
            await save.mutateAsync({ pin });
            setPin('');
            message.success('PIN saved.');
          } catch (error) {
            message.error(error instanceof ApiError ? error.message : 'Could not save the PIN.');
          }
        }}
      >
        Save PIN
      </button>
    </div>
  );
}
