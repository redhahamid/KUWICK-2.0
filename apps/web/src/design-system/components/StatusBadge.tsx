import { Badge } from 'antd';
import type { StatusTone } from '@kuwick/shared';
import { colors } from '../tokens';

const toneColor: Record<StatusTone, string> = {
  success: colors.success,
  active: colors.active,
  attention: colors.attention,
  warning: colors.warning,
  error: colors.error,
  neutral: colors.neutral,
};

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

// Shared status rendering for every lifecycle entity (appointment, queue,
// procurement, panel claim) — see docs/UI_DESIGN_SYSTEM.md §5.
// Color is never the only signal: the text label always renders too.
export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return <Badge color={toneColor[tone]} text={label} />;
}
