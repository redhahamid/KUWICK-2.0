import { ReactNode, useEffect, useRef, useState } from 'react';
import { Drawer } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { canvasWidths, CanvasWidths } from './canvasLayout';
import './canvas.css';

/**
 * Kuwick 2.0 Canvas — the three-column shell.
 *
 * This is geometry and nothing else. It takes three slots and places them;
 * it knows no clinical rules, fetches nothing, and owns no visit state. Each
 * phase of the Canvas rebuild fills a slot without touching this file, and
 * the Flow layout never renders it at all.
 *
 * The columns are MEASURED, not guessed from media queries. A media query
 * tests the viewport, but this shell sits inside an app layout with a header
 * and page padding, so the viewport is 60–90px wider than the space actually
 * available. Measuring the container is what makes the note's minimum width
 * a real guarantee rather than an approximate one.
 */
export interface CanvasWorkspaceProps {
  /** Full-height visits history. Folds away first when width runs out. */
  visits: ReactNode;
  /** The note, diagnosis and documents — what the doctor WRITES. */
  middle: ReactNode;
  /** Orders, medications and the live invoice — what the doctor ORDERS. */
  right: ReactNode;
  /** Rendered above the columns, full width (the completion bar). */
  footer?: ReactNode;
}

export function CanvasWorkspace({ visits, middle, right, footer }: CanvasWorkspaceProps) {
  const shell = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<CanvasWidths | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const node = shell.current;
    if (!node) return undefined;

    const measure = () => setWidths(canvasWidths(node.clientWidth));
    measure();

    // ResizeObserver is absent in jsdom and in older Safari. Falling back to
    // the window resize event keeps the layout correct rather than leaving it
    // stuck at its first measurement.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Before the first measurement the mode is unknown. Rendering the three
  // columns unsized is right: the browser lays them out sensibly for one
  // frame, and nothing jumps in from a wrong assumed width.
  const mode = widths?.mode ?? 'three-column';
  const sized = (width: number | undefined) =>
    width && mode !== 'stacked' ? { width, flexBasis: width } : undefined;

  /**
   * HISTORY COMPRESSES, IT NEVER DISAPPEARS.
   *
   * Below 1280 the visits column folds so the note keeps a readable width —
   * but a doctor reaches for history mid-consultation, and a rail that is
   * simply gone at 1180 is a rail they have to leave the consultation to
   * reach. So the column becomes an edge tab that opens the same content as
   * an overlay, dismissible with Esc or a click outside.
   *
   * Only in two-column mode. When stacked, the rail is still on the page —
   * ordered below the work rather than removed — so a second way in would be
   * a duplicate control, not a rescue.
   */
  const railFolded = mode === 'two-column';

  return (
    <div className="kw-canvas2">
      {railFolded && (
        <button
          type="button"
          className="kw2-history-tab"
          onClick={() => setHistoryOpen(true)}
          data-testid="canvas-history-tab"
        >
          <HistoryOutlined />
          <span>Visit history</span>
        </button>
      )}

      <Drawer
        open={railFolded && historyOpen}
        onClose={() => setHistoryOpen(false)}
        placement="left"
        width={320}
        title="Visit history"
        // antd closes on Esc and on a mask click by default; both are stated
        // here so a later prop change cannot remove them silently.
        keyboard
        maskClosable
        rootClassName="kw-canvas2"
        data-testid="canvas-history-drawer"
      >
        {visits}
      </Drawer>

      <div className="kw-canvas2-shell" data-mode={mode} ref={shell} data-testid="canvas-shell">
        <aside
          className="kw-canvas2-col kw-canvas2-visits"
          style={sized(widths?.visits)}
          aria-label="Visit history"
          data-testid="canvas-visits"
        >
          {visits}
        </aside>

        <div
          className="kw-canvas2-col kw-canvas2-middle"
          style={sized(widths?.middle)}
          data-testid="canvas-middle"
        >
          {middle}
        </div>

        <aside
          className="kw-canvas2-col kw-canvas2-right"
          style={sized(widths?.right)}
          aria-label="Orders, medications and invoice"
          data-testid="canvas-right"
        >
          {right}
        </aside>
      </div>

      {footer}
    </div>
  );
}
