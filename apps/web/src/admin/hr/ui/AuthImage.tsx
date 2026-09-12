import { useEffect, useState } from 'react';
import { fetchBlobUrl } from '../../../core/api-client';

/**
 * AN IMAGE BEHIND THE BEARER TOKEN.
 *
 * A selfie kept with a punch, a receipt, a medical certificate: none of them
 * is a bare URL a browser could be pointed at, so `<img src>` cannot fetch
 * one — it sends no Authorization header. The bytes are fetched with the
 * signed-in token and shown from a blob URL, which is revoked when the image
 * goes away.
 *
 * While it loads, and if it fails, an empty box of the same size holds the
 * row's shape rather than collapsing it.
 */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
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
  if (!url) return <span className={className} aria-label={alt} />;
  return <img className={className} src={url} alt={alt} />;
}
