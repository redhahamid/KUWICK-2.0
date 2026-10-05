import { useEffect, type ReactNode } from 'react';
import { Input } from 'antd';
import { IconClose } from './icons';

/**
 * A TABLE, THE SIZE OF THE SCREEN.
 *
 * The kit's drawer is 440px wide: right for one record beside the list it
 * came from, wrong for a six-column contribution schedule, which it cut off
 * and made scroll sideways. This opens a table the way an image viewer opens
 * a photo — centred, nine-tenths of the window, the page dimmed around it —
 * with the column headers and the first column held in place while the body
 * scrolls, and the "find the band" box in the head, where the eye starts.
 * Esc, the close button and a click on the dimmed page all close it; on a
 * phone it is a full-screen sheet.
 */
export function TableModal({
  open,
  title,
  sub,
  onClose,
  search,
  children,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  /** The amount box in the head. The table below decides which band it lights. */
  search?: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  };
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    // The dimmed page. A click on it — and only on it, not on the viewer
    // over it — closes the viewer.
    <div
      className="hr-modalMask"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="hr-modal"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Table'}
      >
        <div className="hr-modal__head">
          <div className="hr-modal__title">
            <h2>{title}</h2>
            {sub ? <div className="hr-sub">{sub}</div> : null}
          </div>
          {search ? (
            <div className="hr-modal__search">
              <Input
                aria-label={search.label}
                placeholder={search.placeholder}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                allowClear
                autoFocus
              />
            </div>
          ) : null}
          <button
            type="button"
            className="hr-btn hr-btn--sm hr-btn--icon hr-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>
        <div className="hr-modal__body">{children}</div>
      </div>
    </div>
  );
}
