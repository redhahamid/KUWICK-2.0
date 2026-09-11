import type { ReactNode } from 'react';

/** A button that is only a glyph. The label is still required — for a screen
    reader it is the whole button. */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="hr-btn hr-btn--sm hr-btn--icon" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
