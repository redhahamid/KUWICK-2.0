import { useEffect, useRef, useState } from 'react';
import { fetchBlobUrl } from '../../core/api-client';

// G0b (D-055) — clinical images have to be *looked at*, not downloaded.
// Otoscope, wound, dermatology and endoscopy photos are the whole reason a
// visit carries attachments, and until now the only way to see one was to
// download the file and open it outside the record.
//
// A plain <img src="/visits/.../download"> cannot work: the endpoint needs an
// Authorization header. So the bytes are fetched here and handed back as
// object URLs, the same approach PrintOrderResultPage already uses for order
// attachments.
//
// Object URLs pin their blob in memory until revoked, and a busy clinic day
// can open a lot of records — so every URL this hook creates is revoked when
// the set changes or the component unmounts. Nothing is cached across
// records: a stale image under the wrong patient would be worse than a
// refetch.
export function useAttachmentBlobUrls(
  visitId: string | undefined,
  attachments: { id: string; mimeType: string }[] | undefined,
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Revoking straight from state would need it as an effect dependency, which
  // would re-run the effect on its own result. A ref holds what must be freed.
  const created = useRef<string[]>([]);

  const imageIds = (attachments ?? [])
    .filter((a) => a.mimeType?.startsWith('image/'))
    .map((a) => a.id)
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = imageIds ? imageIds.split(',') : [];

    const revokeAll = () => {
      created.current.forEach((url) => URL.revokeObjectURL(url));
      created.current = [];
    };

    if (!visitId || ids.length === 0) {
      revokeAll();
      setUrls({});
      return;
    }

    void Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await fetchBlobUrl(`/visits/${visitId}/attachments/${id}/download`)] as const;
        } catch {
          // One unreadable file must not blank out the rest of the gallery.
          // The caller falls back to the non-image row for this attachment.
          return [id, ''] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        entries.forEach(([, url]) => url && URL.revokeObjectURL(url));
        return;
      }
      revokeAll();
      const next: Record<string, string> = {};
      entries.forEach(([id, url]) => {
        if (url) {
          next[id] = url;
          created.current.push(url);
        }
      });
      setUrls(next);
    });

    return () => {
      cancelled = true;
      revokeAll();
    };
  }, [visitId, imageIds]);

  return urls;
}
