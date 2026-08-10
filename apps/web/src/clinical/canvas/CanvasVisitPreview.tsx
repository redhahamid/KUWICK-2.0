import { Skeleton } from 'antd';
import { useVisitHistoryDetail } from '../history/useVisitHistory';
import { formatClinicDate } from '../clinicTime';
import { buildVisitPreview } from './visitPreview';

/**
 * Kuwick 2.0 Canvas — the note preview that opens beside a hovered past visit
 * (spec p.2, "hover any visit = note preview").
 *
 * It reuses `useVisitHistoryDetail` — the read-only history query (D-067) —
 * which means three things at once: the request already exists, the cache is
 * keyed per visit so a second hover on the same card costs nothing, and the
 * key is namespaced under 'visit-history' so nothing here can reach, refresh
 * or invalidate the live consultation's caches. A doctor's unsaved note is
 * untouchable from this component because it never names the query holding it
 * (C1/D-091).
 *
 * The panel is INERT: no buttons, no links, no focus trap. It is something to
 * read on the way past, and everything it can show has a permanent home one
 * click away in "Open ▸".
 */
interface CanvasVisitPreviewProps {
  patientId: string;
  visitId: string;
  /** For the heading, so the panel says which visit it is describing. */
  label: string;
}

export function CanvasVisitPreview({ patientId, visitId, label }: CanvasVisitPreviewProps) {
  const { data, isPending, isError } = useVisitHistoryDetail(patientId, visitId);
  const preview = buildVisitPreview(data, formatClinicDate);

  return (
    <aside
      className="kw2-visit-preview"
      // Not a dialog and not a tooltip: it is a supplementary description of
      // the card, announced politely if a screen reader is following along and
      // never stealing the reading position.
      role="note"
      aria-label={`Note preview, ${label}`}
      data-testid="canvas-visit-preview"
    >
      <header className="kw2-preview-head">{label}</header>

      {isPending && <Skeleton active paragraph={{ rows: 3 }} title={false} />}

      {isError && (
        // The rail card's own facts are still on screen and still true. This
        // says only that the preview failed — never that the visit is empty.
        <p className="kw2-preview-muted">Preview unavailable. Open the visit to read it.</p>
      )}

      {!isPending && !isError && (
        <>
          {preview.attribution && <div className="kw2-preview-attrib">{preview.attribution}</div>}
          {preview.withheld ? (
            <p className="kw2-preview-muted">{preview.withheld}</p>
          ) : (
            <p className="kw2-preview-body">
              {preview.body}
              {preview.truncated && <span className="kw2-preview-more"> … Open ▸ to read the rest</span>}
            </p>
          )}
          {preview.otherNotes > 0 && (
            // Notes are never merged into one paragraph nobody wrote. The
            // count is the honest remainder.
            <div className="kw2-preview-muted">
              {preview.otherNotes === 1 ? '1 further note on this visit' : `${preview.otherNotes} further notes on this visit`}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
