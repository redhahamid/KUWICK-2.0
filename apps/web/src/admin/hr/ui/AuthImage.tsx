import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchBlobUrl } from '../../../core/api-client';

/**
 * AN IMAGE BEHIND THE BEARER TOKEN, AND BIG ENOUGH TO BE EVIDENCE.
 *
 * A selfie kept with a punch, a receipt, a medical certificate: none of them
 * is a bare URL a browser could be pointed at, so `<img src>` cannot fetch
 * one — it sends no Authorization header. The bytes are fetched with the
 * signed-in token and shown from a blob URL, which is revoked when the image
 * goes away.
 *
 * THE THUMBNAIL IS 28 PIXELS SQUARE AND `object-fit: cover`, so it is a CROP
 * — of a face, of a receipt, of an MC. Every one of these is shown because
 * somebody has to check it, and none of them can be checked at that size.
 * Until now pressing one did nothing at all, on all four surfaces that use
 * it: punch selfies, claim receipts, leave attachments, and the employee's
 * own copies in the portal. So the thumbnail is a button, and it opens the
 * whole image, uncropped.
 *
 * IT OPENS THROUGH A PORTAL, unlike the kit's Drawer, for two reasons that
 * are in this stylesheet rather than a preference: `.hr-card` sets
 * `overflow: hidden`, which clips an overlay rendered inside it, and
 * `.hr-card:hover` sets a transform, which makes the card the containing
 * block for `position: fixed` for as long as the pointer rests on it. The
 * portal root carries `kw-hrSlate` so the kit's palette still resolves —
 * outside that class the `--hr-` tokens are not declared and every colour
 * here would fall back to nothing.
 *
 * While it loads, and if it fails, an empty box of the same size holds the
 * row's shape rather than collapsing it.
 */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    fetchBlobUrl(path)
      .then((value) => {
        if (alive) {
          objectUrl = value;
          setUrl(value);
        } else {
          URL.revokeObjectURL(value);
        }
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  // Escape closes it, and the close button takes focus when it opens, so the
  // keyboard is never left behind the overlay it cannot see.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!url) return <span className={className} aria-label={alt} />;

  return (
    <>
      <button type="button" className="hr-proofBtn" onClick={() => setOpen(true)} aria-label={`${alt} — open larger`}>
        <img className={className} src={url} alt={alt} />
      </button>
      {open
        ? createPortal(
            <div className="kw-hrSlate hr-zoom" role="dialog" aria-modal="true" aria-label={alt}>
              {/*
                * The area around the image closes it on a press, which is what
                * a pointer expects. It is hidden from the accessibility tree
                * on purpose: it does exactly what the Close button beside it
                * does, and two controls reading "Close" is a worse screen for
                * anyone listening to it. The keyboard has Close, and Escape.
                */}
              <button type="button" className="hr-zoom__scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
              <img className="hr-zoom__img" src={url} alt={alt} />
              <button type="button" className="hr-zoom__close" ref={closeRef} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
