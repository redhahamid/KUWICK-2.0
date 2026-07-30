import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useQueueTickets } from './hooks/useQueueTickets';
import { useGlobalSetting } from '../core/hooks/useGlobalSetting';

const MONITOR_RUNNING_TEXT_KEY = 'queue_monitor_running_text';

// D-025 (docs/DECISIONS.md): browser SpeechSynthesis, no paid TTS service.
function announce(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// Public-facing waiting-room display (docs/PRODUCT_REQUIREMENTS.md §4).
// Still goes through the same interim x-tenant-id mechanism as every other
// screen (docs/DECISIONS.md D-017) — real per-route public access without a
// tenant identifier isn't possible until real auth ships; this isn't a new
// gap, just this page inheriting the existing one.
export function QueueMonitorPage() {
  const { clinicId } = useParams<{ clinicId: string }>();
  const { data: tickets } = useQueueTickets({ clinicId });
  const { data: runningText } = useGlobalSetting<string>(MONITOR_RUNNING_TEXT_KEY);
  const lastAnnouncedRef = useRef<string | undefined>(undefined);

  const current = tickets?.find((t) => t.status === 'IN_CONSULTATION');
  const waiting = tickets?.filter((t) => t.status === 'WAITING') ?? [];

  const mostRecentlyCalled = tickets
    ?.filter((t) => t.calledAt)
    .sort((a, b) => dayjs(b.calledAt).valueOf() - dayjs(a.calledAt).valueOf())[0];

  useEffect(() => {
    if (mostRecentlyCalled?.calledAt && mostRecentlyCalled.calledAt !== lastAnnouncedRef.current) {
      lastAnnouncedRef.current = mostRecentlyCalled.calledAt;
      announce(`Ticket number ${mostRecentlyCalled.ticketNumber}, please proceed to the consultation room.`);
    }
  }, [mostRecentlyCalled]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b1220',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ flex: 1, display: 'flex', padding: 32, gap: 32 }}>
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 24, opacity: 0.7, marginBottom: 16 }}>Now Serving</div>
          {current ? (
            <>
              <div style={{ fontSize: 140, fontWeight: 700, lineHeight: 1 }}>#{current.ticketNumber}</div>
              <div style={{ fontSize: 32, marginTop: 16 }}>{current.visit.patient?.name}</div>
            </>
          ) : (
            <div style={{ fontSize: 32, opacity: 0.6 }}>No patient is currently being served.</div>
          )}
        </div>
        <div style={{ flex: 1, background: '#131b2e', borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 20, opacity: 0.7, marginBottom: 12 }}>Waiting</div>
          {waiting.length === 0 ? (
            <div style={{ opacity: 0.5 }}>No one waiting</div>
          ) : (
            waiting.map((ticket) => (
              <div key={ticket.id} style={{ fontSize: 28, padding: '8px 0', borderBottom: '1px solid #2a3550' }}>
                #{ticket.ticketNumber}
              </div>
            ))
          )}
        </div>
      </div>
      {runningText && (
        <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', background: '#131b2e', padding: '12px 0' }}>
          <div
            style={{
              display: 'inline-block',
              paddingLeft: '100%',
              animation: 'queue-monitor-scroll 20s linear infinite',
              fontSize: 22,
            }}
          >
            {runningText}
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
