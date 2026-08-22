import { useEffect, useRef, useState } from 'react';
import { Button, Collapse, Input, Space, Typography, Upload, message } from 'antd';
import { DeleteOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { apiClient, ApiError, fetchBlobUrl } from '../../core/api-client';

const { Text } = Typography;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

export type MediaKind = 'SERVICE_PHOTO' | 'CLINIC_LOGO';

/**
 * Resolve a stored image reference to something an <img> can render in the
 * STAFF console: media:// refs become authed blob URLs (an <img src> cannot
 * carry the Authorization header), http(s) URLs pass through.
 */
export function useMediaPreviewUrl(ref: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    const id = ref?.startsWith('media://') ? ref.slice('media://'.length) : null;
    if (!ref) {
      setUrl(null);
    } else if (id) {
      fetchBlobUrl(`/media/${id}`)
        .then((blobUrl) => {
          if (!alive) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          created = blobUrl;
          setUrl(blobUrl);
        })
        .catch(() => alive && setUrl(null));
    } else {
      setUrl(ref);
    }
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [ref]);
  return url;
}

interface MediaUploadFieldProps {
  kind: MediaKind;
  /** antd Form contract: the stored reference — media://<id>, an http(s) URL, or empty. */
  value?: string | null;
  onChange?: (value: string | null) => void;
  /** One line under the control, e.g. "Shown on the service card. JPG/PNG/WebP, up to 2 MB." */
  hint?: string;
}

/**
 * PHASE 6 — upload an image INTO Kuwick instead of hosting it somewhere else
 * first. The field's value is the same string column the URL always lived in:
 * an upload stores `media://<id>`, and pasting an external URL (under
 * Advanced) still works — the fallback stayed real. Preview, replace, remove;
 * removal of an image uploaded in THIS session also deletes the asset, since
 * nothing references it yet.
 */
export function MediaUploadField({ kind, value, onChange, hint }: MediaUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  // Uploaded-then-abandoned assets are the only ones safe to hard-delete
  // from here: anything else might already be referenced by a saved row.
  const sessionUploads = useRef(new Set<string>());

  const mediaId = value?.startsWith('media://') ? value.slice('media://'.length) : null;

  useEffect(() => {
    let revoked: string | null = null;
    let alive = true;
    if (!value) {
      setPreview(null);
    } else if (mediaId) {
      // An <img src> cannot carry the Authorization header; fetch the bytes.
      fetchBlobUrl(`/media/${mediaId}`)
        .then((url) => {
          if (!alive) {
            URL.revokeObjectURL(url);
            return;
          }
          revoked = url;
          setPreview(url);
        })
        .catch(() => alive && setPreview(null));
    } else {
      setPreview(value);
    }
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [value, mediaId]);

  const upload = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      message.error('Upload a JPG, PNG or WebP image.');
      return false;
    }
    if (file.size > MAX_BYTES) {
      message.error('That image is over 2 MB. Please use a smaller one.');
      return false;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      const result = await apiClient.postFile<{ id: string; ref: string }>(
        `/media?kind=${kind}`,
        body,
      );
      sessionUploads.current.add(result.id);
      onChange?.(result.ref);
      message.success('Image uploaded.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'That image could not be uploaded.');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const remove = async () => {
    const removingId = mediaId;
    onChange?.(null);
    if (removingId && sessionUploads.current.has(removingId)) {
      sessionUploads.current.delete(removingId);
      try {
        await apiClient.delete(`/media/${removingId}`);
      } catch {
        // The reference is gone either way; an orphaned 2 MB row is not an
        // error worth stopping anybody for.
      }
    }
  };

  return (
    <div className="kw-media-field" data-testid={`media-field-${kind.toLowerCase()}`}>
      <div className="kw-media-preview">
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <span className="kw-media-empty" aria-hidden>
            <PictureOutlined />
          </span>
        )}
        <Space direction="vertical" size={6}>
          <Space size={8} wrap>
            <Upload
              accept={IMAGE_TYPES.join(',')}
              showUploadList={false}
              beforeUpload={(file) => upload(file)}
            >
              <Button size="small" icon={<UploadOutlined />} loading={uploading}>
                {value ? 'Replace image' : 'Upload image'}
              </Button>
            </Upload>
            {value ? (
              <Button size="small" icon={<DeleteOutlined />} onClick={remove}>
                Remove
              </Button>
            ) : null}
          </Space>
          {hint ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {hint}
            </Text>
          ) : null}
        </Space>
      </div>

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'advanced',
            label: <Text type="secondary" style={{ fontSize: 12 }}>Advanced: use an image URL</Text>,
            children: (
              <Input
                size="small"
                placeholder="https://…"
                value={value && !mediaId ? value : ''}
                onChange={(event) => onChange?.(event.target.value || null)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
