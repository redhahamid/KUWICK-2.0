import type { ReactNode } from 'react';

/**
 * THE MOCKUPS' OWN ICONS, TRACED RATHER THAN APPROXIMATED.
 *
 * Every path below is copied from `docs/design/hr-slate/*.html`. No icon
 * library: the kit draws with a 1.75 stroke on a 24-unit box, and the nearest
 * match from a pack is a different weight at a different optical size, which
 * is visible the moment two of them sit side by side in the rail.
 *
 * Size, stroke and colour come from CSS (`slate.css`), so the same glyph works
 * at 17px in the rail, 14px in a button and 15px on a stat label.
 */
const Glyph = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const IconEmployees = () => (
  <Glyph>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </Glyph>
);

export const IconPayroll = () => (
  <Glyph>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M8 15h4" />
  </Glyph>
);

export const IconClock = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Glyph>
);

export const IconCalendar = () => (
  <Glyph>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Glyph>
);

export const IconClaims = () => (
  <Glyph>
    <path d="M5 4h10l4 4v12H5z" />
    <path d="M9 13h6M9 17h6" />
  </Glyph>
);

export const IconReports = () => (
  <Glyph>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Glyph>
);

export const IconSettings = () => (
  <Glyph>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
  </Glyph>
);

export const IconCompany = () => (
  <Glyph>
    <path d="M3 21h18M5 21V7l7-4 7 4v14" />
    <path d="M9 21v-5h6v5" />
  </Glyph>
);

export const IconList = () => (
  <Glyph>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Glyph>
);

export const IconSliders = () => (
  <Glyph>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="7" cy="18" r="2" />
  </Glyph>
);

export const IconOpeningBalances = () => (
  <Glyph>
    <path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM10 13h4" />
  </Glyph>
);

export const IconSearch = () => (
  <Glyph>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Glyph>
);

export const IconLock = () => (
  <Glyph>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Glyph>
);

export const IconInfo = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Glyph>
);

export const IconEdit = () => (
  <Glyph>
    <path d="M4 20h4l10-10-4-4L4 16v4z" />
    <path d="M12.5 7.5l4 4" />
  </Glyph>
);

export const IconMore = () => (
  <Glyph>
    <circle cx="6" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="18" cy="12" r="1.2" />
  </Glyph>
);

export const IconDownload = () => (
  <Glyph>
    <path d="M12 4v11M7 10l5 5 5-5" />
    <path d="M4 19h16" />
  </Glyph>
);

export const IconHistory = () => (
  <Glyph>
    <path d="M4 12a8 8 0 1 0 2.3-5.7" />
    <path d="M4 4v4.5h4.5" />
    <path d="M12 8v4l3 2" />
  </Glyph>
);

export const IconDoc = () => (
  <Glyph>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </Glyph>
);

export const IconPlus = () => (
  <Glyph>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);

export const IconClose = () => (
  <Glyph>
    <path d="M6 6l12 12M18 6 6 18" />
  </Glyph>
);
