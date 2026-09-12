import { useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { ApiError } from '../core/api-client';
import { Drawer } from '../admin/hr/ui';
import { IconClock } from '../admin/hr/ui/icons';
import { useClockSelf, useGiveSelfieConsent, useMyProfile, uploadMyFile } from './hooks/useMe';

/**
 * CLOCK IN FROM THE PORTAL — phase 1, no device (prompt §7).
 *
 * The one button does three things, in this order, and gives up on each
 * gracefully rather than refusing the punch:
 *
 *   1. CONSENT, once. Before the first selfie a short screen says what the
 *      picture is for (proof that you were here, shown to HR, nothing else)
 *      and the answer is dated on the profile. "Not now" clocks without one.
 *   2. POSITION. The phone's location, if it will say (8 s, then without).
 *      The server judges it against the branch's radius; outside is kept and
 *      flagged for the manager, never rejected.
 *   3. SELFIE. The front camera in a small drawer; one tap takes the photo.
 *      No camera, or no permission: the punch goes in without a photo and
 *      says so.
 *
 * Nothing here decides anything. The server records what it was given.
 */

type Position = { lat: number; lng: number } | null;

function readPosition(): Promise<Position> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (value: Position) => resolve(value);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }),
        () => done(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      );
    } catch {
      done(null);
    }
  });
}

function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Frame → JPEG, scaled so the long side is at most 640px: a few tens of KB, enough to see a face. */
function frameToJpeg(video: HTMLVideoElement): Promise<Blob | null> {
  const scale = Math.min(1, 640 / Math.max(video.videoWidth || 640, video.videoHeight || 480));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((video.videoWidth || 640) * scale);
  canvas.height = Math.round((video.videoHeight || 480) * scale);
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82));
}

export function ClockButton({ onDuty, disabled }: { onDuty: boolean; disabled?: boolean }) {
  const { message } = App.useApp();
  const { data: profile } = useMyProfile();
  const clock = useClockSelf();
  const consent = useGiveSelfieConsent();
  const [asking, setAsking] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  useEffect(() => stopCamera, []);

  const punch = async (proofFileId?: string) => {
    setBusy(true);
    try {
      const position = await readPosition();
      await clock.mutateAsync({ ...(position ?? {}), ...(proofFileId ? { proofFileId } : {}) });
      message.success(
        `${onDuty ? 'Clocked out' : 'Clocked in'}${position ? '' : ' (no position from the phone)'}${proofFileId ? '' : ' (no selfie)'}.`,
      );
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  const openCamera = async () => {
    if (!cameraAvailable()) {
      await punch();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setCamera(true);
      // The drawer mounts on the next paint; attach the stream then.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      }, 50);
    } catch {
      message.info('No camera, so this punch goes in without a selfie.');
      await punch();
    }
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const blob = await frameToJpeg(video);
      stopCamera();
      setCamera(false);
      if (!blob) {
        await punch();
        return;
      }
      const uploaded = await uploadMyFile('SELFIE', blob, `selfie-${Date.now()}.jpg`);
      await punch(uploaded.id);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not keep the photo; the punch was not recorded.');
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (profile && !profile.selfieConsentAt) {
      setAsking(true);
      return;
    }
    await openCamera();
  };

  const agree = async () => {
    try {
      await consent.mutateAsync({});
      setAsking(false);
      await openCamera();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not record your consent.');
    }
  };

  const withoutSelfie = async () => {
    setAsking(false);
    await punch();
  };

  return (
    <>
      <button
        type="button"
        className={onDuty ? 'hr-btn' : 'hr-btn hr-btn--primary'}
        onClick={start}
        disabled={disabled || busy || clock.isPending}
      >
        <IconClock />
        {onDuty ? 'Clock out' : 'Clock in'}
      </button>

      <Drawer
        open={asking}
        title="A photo with each punch"
        sub="Asked once. Your answer is dated on your record."
        onClose={() => setAsking(false)}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={withoutSelfie} disabled={busy}>
              Not now, clock without a photo
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={agree} disabled={consent.isPending || busy}>
              I agree
            </button>
          </>
        }
      >
        <div className="hr-portal__consent">
          <p>
            When you clock in or out from this portal, the phone takes a photo of you with the front camera and keeps it
            with the punch, together with where the phone was.
          </p>
          <p>
            The photo is proof that you were at the clinic at that minute. It is shown to your manager and HR on the
            timesheet, and it is used for nothing else: no face recognition, no matching, no sharing.
          </p>
          <p>You can clock without a photo at any time; the punch is then recorded without proof.</p>
        </div>
      </Drawer>

      <Drawer
        open={camera}
        title={onDuty ? 'Clock out' : 'Clock in'}
        sub="Look at the camera, then take the photo."
        onClose={() => {
          stopCamera();
          setCamera(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="hr-btn"
              onClick={() => {
                stopCamera();
                setCamera(false);
                void punch();
              }}
              disabled={busy}
            >
              Skip the photo
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={takePhoto} disabled={busy}>
              Take photo and {onDuty ? 'clock out' : 'clock in'}
            </button>
          </>
        }
      >
        <div className="hr-portal__camera">
          <video ref={videoRef} autoPlay playsInline muted />
        </div>
      </Drawer>
    </>
  );
}
