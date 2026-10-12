import { useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { ApiError, fetchBlobUrl } from '../../core/api-client';
import { useRemoveEmployerLogo, useSetEmployerLogo } from '../hooks/useAdmin';

const LOGO_TYPES = ['image/png', 'image/jpeg'];
const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * THE COMPANY LOGO PRINTED ON PAYSLIPS (UAT, 12 October 2026). PNG or JPG up
 * to 1 MB, saved straight away; with none, the payslip prints the name's
 * initial letter.
 */
export function EmployerLogoField({
  employerId,
  employerName,
  logoMediaId,
  mayManage,
}: {
  employerId: string;
  employerName: string;
  logoMediaId: string | null;
  mayManage: boolean;
}) {
  const { message } = App.useApp();
  const setLogo = useSetEmployerLogo();
  const removeLogo = useRemoveEmployerLogo();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<string | null>(logoMediaId);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    setPreview(null);
    if (current) {
      fetchBlobUrl(`/workforce/legal-employers/${employerId}/logo`)
        .then((url) => {
          if (!alive) return URL.revokeObjectURL(url);
          created = url;
          setPreview(url);
        })
        .catch(() => alive && setPreview(null));
    }
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [employerId, current]);

  const upload = async (file: File) => {
    if (!LOGO_TYPES.includes(file.type)) return message.error('Upload the logo as a PNG or JPG image.');
    if (file.size > MAX_LOGO_BYTES) return message.error('That logo is over 1 MB. Please use a smaller image.');
    setBusy(true);
    try {
      const saved = await setLogo.mutateAsync({ employerId, file });
      setCurrent(saved.logoMediaId);
      message.success('Logo saved. It prints on payslips from now on.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'That logo could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeLogo.mutateAsync(employerId);
      setCurrent(null);
      message.success('Logo removed. Payslips print the initial letter instead.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'The logo could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="hr-small hr-muted" style={{ marginBottom: 4 }}>Payslip logo</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          aria-label="Logo preview"
          style={{
            width: 48,
            height: 48,
            borderRadius: 9,
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            background: preview ? 'transparent' : '#16302b',
            color: '#fff',
            fontWeight: 700,
            fontSize: 20,
            flex: 'none',
          }}
        >
          {preview ? <img src={preview} alt={`${employerName} logo`} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : (employerName.trim()[0] ?? 'K').toUpperCase()}
        </div>
        {mayManage ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="hr-btn" disabled={busy} onClick={() => input.current?.click()}>
              {current ? 'Replace logo' : 'Upload logo'}
            </button>
            {current ? (
              <button type="button" className="hr-btn" disabled={busy} onClick={remove}>
                Remove
              </button>
            ) : null}
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Logo file"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="hr-small hr-muted" style={{ marginTop: 4 }}>
        PNG or JPG, up to 1 MB. Without one, payslips print the first letter of the company name.
      </div>
    </div>
  );
}
