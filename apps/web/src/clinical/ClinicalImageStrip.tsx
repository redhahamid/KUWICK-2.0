import { Button, Image, Space, Tooltip, Typography } from 'antd';
import { FileOutlined, FilePdfOutlined } from '@ant-design/icons';
import { downloadVisitAttachment, useVisitAttachments } from './hooks/useVisitAttachments';
import { useAttachmentBlobUrls } from './hooks/useAttachmentBlobUrls';
import { attachmentKind, canRenderAsImage } from './attachmentPresentation';

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
  /** D-077 — reveals the full attachments panel (upload, non-image files). */
  expanded?: boolean;
  onToggleExpand?: () => void;
  visitId: string;
}

export function ClinicalImageStrip({ visitId, expanded, onToggleExpand }: ClinicalImageStripProps) {
  const { data: attachments } = useVisitAttachments(visitId);
  const active = (attachments ?? []).filter((file) => file.recordStatus === 'ACTIVE');
  const blobUrls = useAttachmentBlobUrls(visitId, active);
  const images = active.filter((file) => canRenderAsImage(file, blobUrls[file.id]));
  // G4.5d3c-3c — non-image files used to be a NUMBER and nothing else: a
  // scanned referral letter or a lab PDF appeared on the Canvas as the words
  // "1 non-image", with no name, no icon and no way to open it without
  // expanding the panel to look for it. They are file cards now, beside the
  // thumbnails, and one click downloads them exactly as the panel does.
  const documents = active.filter((file) => !images.includes(file));

  // D-077 — ONE compact row when nothing is attached. The full panel rendered
  // a large empty placeholder that ate most of a tablet screen on a visit with
  // no images, for information that amounts to the number zero.
  if (active.length === 0) {
    return (
      <div className="kw-image-strip">
        <Text type="secondary" style={{ fontSize: 12 }}>
          Attachments 0
        </Text>
        {onToggleExpand && (
          <Button size="small" style={{ marginLeft: 'auto' }} onClick={onToggleExpand}>
            {expanded ? 'Hide' : 'Upload'}
          </Button>
        )}
      </div>
    );
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
      {documents.length > 0 && (
        <Space size={6} wrap>
          {documents.map((file) => (
            <Tooltip key={file.id} title={`${file.fileName} — open`}>
              <Button
                size="small"
                data-attachment-kind={attachmentKind(file)}
                icon={attachmentKind(file) === 'PDF' ? <FilePdfOutlined /> : <FileOutlined />}
                onClick={() => downloadVisitAttachment(visitId, file)}
              >
                <span
                  style={{
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'inline-block',
                    verticalAlign: 'bottom',
                  }}
                >
                  {file.fileName}
                </span>
              </Button>
            </Tooltip>
          ))}
        </Space>
      )}
      <Text type="secondary" style={{ fontSize: 12 }}>
        Attachments {active.length}
      </Text>
      {onToggleExpand && (
        <Button size="small" style={{ marginLeft: 'auto' }} onClick={onToggleExpand}>
          {expanded ? 'Hide' : 'Upload'}
        </Button>
      )}
    </div>
  );
}
