import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { usePublicQueueMonitor } from './hooks/useQueueTickets';
import { PublicQueueTicket, QueueDisplayConfig, QueueType } from './types';

const QUEUE_TYPE_LABEL: Record<QueueType, string> = {
  APPOINTMENT: 'Appointment',
  OTC: 'OTC',
  WALK_IN: 'Walk-in',
  EMERGENCY: 'Emergency',
};

const QUEUE_TYPE_COLOR: Record<QueueType, string> = {
  APPOINTMENT: '#2f5bf6',
  OTC: '#0ea5e9',
  WALK_IN: '#22c55e',
  EMERGENCY: '#ef4444',
};

// Spells the number out digit by digit ("W zero zero one") so the voice
// doesn't read "W001" as "W one" or "W thousand-and-one".
function spellDisplayNumber(displayNumber: string): string {
  return displayNumber
    .split('')
    .map((char) => (char === '0' ? 'zero' : char))
    .join(' ');
}

// D-025: browser SpeechSynthesis, no paid TTS service. D-038: voice name/
// rate/pitch/volume come from the clinic's own display config.
function announce(text: string, config: QueueDisplayConfig) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  if (config.voiceName) {
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === config.voiceName);
    if (voice) utterance.voice = voice;
  }
  utterance.rate = config.voiceRate;
  utterance.pitch = config.voicePitch;
  utterance.volume = config.voiceVolume;
  window.speechSynthesis.speak(utterance);
}

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return match ? match[1] : null;
}

// Public-facing waiting-room display (docs/PRODUCT_REQUIREMENTS.md §4,
// D-038). Fetches the unauthenticated /public/queue endpoint — numbers and
// room names only, no patient PII — so a TV can show this URL without any
// login. Meant to run full-screen.
export function QueueMonitorPage() {
  const { clinicId } = useParams<{ clinicId: string }>();
  const { data } = usePublicQueueMonitor(clinicId);
  const lastAnnouncedRef = useRef<string | undefined>(undefined);

  const tickets = data?.tickets ?? [];
  const waiting = tickets.filter((t) => t.status === 'WAITING');

  const mostRecentlyCalled = tickets
    .filter((t) => t.calledAt)
    .sort((a, b) => dayjs(b.calledAt).valueOf() - dayjs(a.calledAt).valueOf())[0];

  useEffect(() => {
    if (!data || !mostRecentlyCalled?.calledAt) return;
    const announceKey = `${mostRecentlyCalled.id}:${mostRecentlyCalled.calledAt}`;
    if (announceKey !== lastAnnouncedRef.current) {
      lastAnnouncedRef.current = announceKey;
      const destination = mostRecentlyCalled.roomName
        ? `please proceed to ${mostRecentlyCalled.roomName}`
        : 'please proceed to the counter';
      announce(`Number ${spellDisplayNumber(mostRecentlyCalled.displayNumber)}, ${destination}.`, data.config);
    }
  }, [data, mostRecentlyCalled]);

  const videoId = data?.config.youtubeUrl ? extractYoutubeVideoId(data.config.youtubeUrl) : null;

  return (
    <div
      style={{
        height: '100vh',
        background: '#0b1220',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 32px', fontSize: 26, fontWeight: 600, borderBottom: '1px solid #1d2740' }}>
        {data?.clinic.name ?? ''}
      </div>
      <div style={{ flex: 1, display: 'flex', padding: 24, gap: 24, minHeight: 0 }}>
        <div style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <div
            style={{
              background: '#131b2e',
              borderRadius: 12,
              padding: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              minHeight: 220,
            }}
          >
            <div style={{ fontSize: 22, opacity: 0.7, marginBottom: 8 }}>Now Calling</div>
            {mostRecentlyCalled ? (
              <>
                <div style={{ fontSize: 110, fontWeight: 700, lineHeight: 1, color: '#4ade80' }}>
                  {mostRecentlyCalled.displayNumber}
                </div>
                <div style={{ fontSize: 34, marginTop: 12 }}>{mostRecentlyCalled.roomName ?? ''}</div>
              </>
            ) : (
              <div style={{ fontSize: 28, opacity: 0.6 }}>Please wait for your number</div>
            )}
          </div>
          {videoId && (
            <div style={{ flex: 1, borderRadius: 12, overflow: 'hidden', minHeight: 0 }}>
              <iframe
                title="Clinic video"
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=0&modestbranding=1`}
                frameBorder="0"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            </div>
          )}
        </div>
        <div style={{ flex: 1, background: '#131b2e', borderRadius: 12, padding: 20, overflowY: 'auto' }}>
          <div style={{ fontSize: 20, opacity: 0.7, marginBottom: 12 }}>Waiting ({waiting.length})</div>
          {waiting.length === 0 ? (
            <div style={{ opacity: 0.5 }}>No one waiting</div>
          ) : (
            waiting.map((ticket: PublicQueueTicket) => (
              <div
                key={ticket.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 26,
                  padding: '10px 0',
                  borderBottom: '1px solid #2a3550',
                }}
              >
                <span style={{ fontWeight: 600 }}>{ticket.displayNumber}</span>
                <span style={{ fontSize: 13, color: QUEUE_TYPE_COLOR[ticket.queueType] }}>
                  {QUEUE_TYPE_LABEL[ticket.queueType]}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      {data?.config.runningText && (
        <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', background: '#131b2e', padding: '12px 0' }}>
          <div
            style={{
              display: 'inline-block',
              paddingLeft: '100%',
              animation: 'queue-monitor-scroll 20s linear infinite',
              fontSize: 22,
            }}
          >
            {data.config.runningText}
          </div>
        </div>
      )}
      <style>{`
        @keyframes queue-monitor-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
