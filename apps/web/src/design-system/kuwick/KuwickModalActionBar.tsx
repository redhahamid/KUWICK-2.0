import { ReactNode } from 'react';

/**
 * G4.5d5b-1 — the modal footer, with ONE button order.
 *
 * Cancel on the left, the primary action on the right, secondary actions
 * between them. That order is arbitrary in isolation and load-bearing in
 * aggregate: staff learn where the confirm button is, and a modal that puts
 * it somewhere else is where the mis-clicks come from.
 *
 * On mobile this bar is sticky at the bottom of the sheet (see index.css), so
 * a long form cannot hide its own confirm button behind the keyboard.
 */
export interface KuwickModalActionBarProps {
  /** Rendered leftmost. Usually Cancel. */
  cancel?: ReactNode;
  /** Between cancel and primary. Print, Add & Add Another, and so on. */
  secondary?: ReactNode;
  /** Rendered rightmost. Exactly one. */
  primary: ReactNode;
}

export function KuwickModalActionBar({ cancel, secondary, primary }: KuwickModalActionBarProps) {
  return (
    <div className="kw-action-bar">
      <div className="kw-action-bar-start">{cancel}</div>
      <div className="kw-action-bar-end">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
