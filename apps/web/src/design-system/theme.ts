import type { ThemeConfig } from 'antd';
import { colors } from './tokens';

// Ant Design theme — compact algorithm per docs/UI_DESIGN_SYSTEM.md §1.
export const kuwickTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
};
