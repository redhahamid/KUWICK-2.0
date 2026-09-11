import { useEffect, type ReactNode } from 'react';
import { IconClose } from './icons';

/**
 * ONE RECORD, BESIDE THE LIST IT CAME FROM.
 *
 * A decision — approve this leave, pay this claim — is made against the list
 * as much as against the record, so the list stays on screen. It starts below
 * the slate header rather than over it, because the header is how you leave.
 */
export function Drawer({
  open,
  title,
  sub,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // Escape closes it. A drawer you can only leave with the mouse is a drawer
  // somebody gets stuck in behind a form they did not mean to open.
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
    <aside className="hr-drawer" role="dialog" aria-modal="false" aria-label={typeof title === 'string' ? title : 'Details'}>
      <div className="hr-drawer__head">
        <div>
          <h2>{title}</h2>
          {sub ? <div className="hr-sub" style={{ fontSize: 13 }}>{sub}</div> : null}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button type="button" className="hr-btn hr-btn--sm hr-btn--icon" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
      </div>
      <div className="hr-drawer__body">{children}</div>
      {footer ? <div className="hr-drawer__foot">{footer}</div> : null}
    </aside>
  );
}
