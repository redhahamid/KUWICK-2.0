import type { ThemeConfig } from 'antd';
import { colors } from './tokens';

/**
 * The Ant Design theme, fed from the Kuwick tokens.
 *
 * G4.5d5b-1 — `colorPrimary` is Kuwick navy now, not antd's default blue.
 * That one line is why the workspace needed `!important` overrides on every
 * primary button: the library was painting them blue and the stylesheet was
 * painting them back. Anything built from here on comes out navy on its own,
 * which is the point of having a theme at all.
 */
export const kuwickTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,
    colorInfo: colors.active,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    colorBorder: colors.border,
    borderRadius: 8,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  components: {
    // A clinical surface reads better with a little more air than antd's
    // compact defaults give it, without going to the loose default either.
    Modal: { borderRadiusLG: 12 },
    Card: { borderRadiusLG: 10 },
  },
};
