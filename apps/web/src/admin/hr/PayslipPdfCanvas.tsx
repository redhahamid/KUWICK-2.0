import { useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import { fetchBlobUrl } from '../../core/api-client';

/**
 * ONE PAYSLIP, DRAWN FROM ITS PDF (UAT, 14 October 2026): "shows each payslip
 * on screen exactly as the PDF looks". The server's PDF is fetched through the
 * audited route and painted page by page with pdf.js, because a phone browser
 * will not show a PDF inside the page. Nothing here composes a payslip.
 *
 * pdf.js loads on first use, so a payroll page that never opens the preview
 * never downloads it. Its own file so the screen's tests can stand it in.
 */
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

export function PayslipPdfCanvas({ path, label }: { path: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    let destroy: (() => void) | null = null;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        url = await fetchBlobUrl(path);
        if (cancelled) return;
        const task = pdfjs.getDocument({ url });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        const target = host.current;
        if (cancelled || !target) return;
        const width = Math.max(target.clientWidth, 280);
        const ratio = window.devicePixelRatio || 1;
        const canvases: HTMLCanvasElement[] = [];
        for (let number = 1; number <= doc.numPages; number += 1) {
          const page = await doc.getPage(number);
          const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'hr-payslipPreview__page';
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          if (cancelled) return;
          canvases.push(canvas);
        }
        target.replaceChildren(...canvases);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error && e.message ? e.message : 'The payslip could not be shown.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  return (
    <div className="hr-payslipPreview__paper" role="img" aria-label={label} aria-busy={loading}>
      {error ? <div className="hr-notice hr-notice--attn">{error}</div> : null}
      <div ref={host} className="hr-payslipPreview__pages" />
      {loading ? (
        <div className="hr-payslipPreview__loading">
          <Spin />
        </div>
      ) : null}
    </div>
  );
}
