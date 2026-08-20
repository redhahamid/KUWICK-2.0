import type { ThemeConfig } from 'antd';

/**
 * V3 — the appointment module's own Ant Design theme layer.
 *
 * Nested inside the global `kuwickTheme` ConfigProvider, so it MERGES over the
 * product theme rather than replacing it: everything not named here (status
 * base hues, font stack, text colours) still comes from the one product theme,
 * and no other module changes appearance. This is the "scoped tokens" half of
 * the V3 brief — the CSS half lives in `appointment-v3.css` as `--apt-*`
 * custom properties.
 *
 * The choices, stated once:
 *
 *   PRIMARY IS INK NAVY (#132447 → #0B1736 on hover), the dark-pill language
 *   of the approved clinical Canvas — not a brighter blue, and not teal,
 *   because teal is the SELECTED/clinical accent everywhere in this product
 *   (D-105 §13) and a teal primary would make every button look pre-selected.
 *
 *   THE VIEW SWITCHER IS DARK-FILLED (Segmented selected = deep navy). One
 *   glance says which of Day/Week/Month/Providers is on screen.
 */
export const appointmentTheme: ThemeConfig = {
  token: {
    colorPrimary: '#132447',
    colorPrimaryHover: '#0B1736',
    colorPrimaryActive: '#0B1736',
    colorInfo: '#132447',
    colorLink: '#0F6B78',
    colorLinkHover: '#0B5965',
    colorText: '#172033',
    colorTextSecondary: '#667085',
    colorBorder: '#D0D5DD',
    colorBorderSecondary: '#E4E7EC',
    borderRadius: 8,
  },
  components: {
    Tabs: {
      itemColor: '#667085',
      itemSelectedColor: '#0B1736',
      itemHoverColor: '#0B1736',
      inkBarColor: '#0F6B78',
      titleFontSize: 14,
      horizontalItemGutter: 24,
    },
    Segmented: {
      itemSelectedBg: '#0B1736',
      itemSelectedColor: '#ffffff',
      trackBg: '#EEF1F5',
      itemColor: '#475467',
      itemHoverColor: '#0B1736',
      trackPadding: 3,
    },
    Button: {
      fontWeight: 600,
      defaultShadow: 'none',
      primaryShadow: 'none',
      defaultBorderColor: '#D0D5DD',
      defaultColor: '#344054',
    },
    Table: {
      headerBg: '#F8FAFC',
      headerColor: '#475467',
      headerSplitColor: 'transparent',
      rowHoverBg: '#F8FAFC',
      cellPaddingBlock: 12,
      cellPaddingInline: 12,
      borderColor: '#EEF1F5',
    },
    Drawer: {
      paddingLG: 20,
    },
    Modal: {
      borderRadiusLG: 12,
    },
    Select: {
      optionSelectedBg: '#EAF5F6',
    },
  },
};

/**
 * The PUBLIC pages' theme — the patient product, not the staff console.
 *
 * Teal-primary on purpose: on the patient's phone the one filled button on
 * screen ("Continue", "Confirm appointment") is a clinical-brand action, and
 * there is no competing "selected vs action" ambiguity because the selected
 * states on this surface are card outlines, not filled buttons. Touch targets
 * come up to 44px via controlHeight.
 */
export const publicBookingTheme: ThemeConfig = {
  token: {
    colorPrimary: '#0F6B78',
    colorPrimaryHover: '#0B5965',
    colorPrimaryActive: '#0B5965',
    colorLink: '#0F6B78',
    colorLinkHover: '#0B5965',
    colorText: '#172033',
    colorTextSecondary: '#667085',
    colorBorder: '#D0D5DD',
    colorBorderSecondary: '#E4E7EC',
    borderRadius: 10,
    controlHeight: 40,
  },
  components: {
    Button: {
      fontWeight: 600,
      primaryShadow: 'none',
      controlHeight: 44,
    },
    Form: {
      labelColor: '#344054',
      verticalLabelPadding: '0 0 6px',
    },
  },
};
