import { Image, Space, Typography } from 'antd';
import { useVisitAttachments } from './hooks/useVisitAttachments';
import { useAttachmentBlobUrls } from './hooks/useAttachmentBlobUrls';

const { Text } = Typography;

/**
 * G4.5a (D-071) — this visit's clinical images, beside the note.
 *
 * Otoscope, wound and rash photos are looked at WHILE writing, so putting
 * them only below the fold meant scrolling away from the note to see the
 * thing being described. Thumbnails are small on purpose: they are a
 * reminder that images exist and a way into the lightbox, not a gallery.
 *
 * ACTIVE attachments only. A removed-in-error file is still retained and
 * still readable through its audited history (G3a/D-062), but it must never
 * appear here as if it were part of the current record.
 *
 * Nothing new is fetched or authorised: the same `useVisitAttachments` list
 * and the same authenticated `useAttachmentBlobUrls` loader the attachments
 * panel already uses, and antd's existing preview group for the lightbox.
 */
interface ClinicalImageStripProps {
  visitId: string;
}

export function ClinicalImageStrip({ visitId }: ClinicalImageStripProps) {
  const { data: attachments } = useVisitAttachments(visitId);
  const active = (attachments ?? []).filter((file) => file.recordStatus === 'ACTIVE');
  const blobUrls = useAttachmentBlobUrls(visitId, active);
  const images = active.filter((file) => file.mimeType?.startsWith('image/') && blobUrls[file.id]);
  const otherFiles = active.length - images.length;

  if (active.length === 0) {
    return null;
  }

  return (
    <div className="kw-image-strip">
      {images.length > 0 && (
        <Image.PreviewGroup>
          <Space size={6} wrap>
            {images.map((file) => (
              <Image
                key={file.id}
                src={blobUrls[file.id]}
                alt={file.fileName}
                width={52}
                height={52}
                style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
              />
            ))}
          </Space>
        </Image.PreviewGroup>
      )}
      {otherFiles > 0 && (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {otherFiles} non-image file{otherFiles === 1 ? '' : 's'} attached
        </Text>
      )}
    </div>
  );
}
