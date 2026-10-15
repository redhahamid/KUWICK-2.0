import type { ReactNode } from 'react';
import { Tooltip } from 'antd';

/**
 * THE LAW, ONE TAP AWAY (new-clinic UAT, 15 October 2026): the sentence on
 * the screen says what happens in plain words; the section and the Act sit
 * behind a small "?" for whoever wants them.
 */
export function LawRef({ children }: { children: ReactNode }) {
  return (
    <Tooltip title={children}>
      <span className="hr-lawRef" role="button" tabIndex={0} aria-label="Where this comes from in the law">
        ?
      </span>
    </Tooltip>
  );
}
