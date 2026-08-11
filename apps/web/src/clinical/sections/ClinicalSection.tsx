import { ReactNode } from 'react';
import { Alert, Button, Dropdown, Skeleton, Space, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined, MoreOutlined, RightOutlined } from '@ant-design/icons';

const { Text } = Typography;

export interface ClinicalSectionProps {
  title: string;
  /** Omitted where a count is meaningless — Invoice, for instance. */
  count?: number;
  /** One line the doctor can read without expanding anything. */
  summary?: ReactNode;
  /** A badge or tag beside the summary (payment state, order progress). */
  status?: ReactNode;
  primaryAction?: {
    label: string;
    onClick: () => void;
    /** Set when the action exists but this user/record may not use it. */
    disabledReason?: string;
  };
  secondaryActions?: MenuProps['items'];
  isLoading?: boolean;
  error?: unknown;
  /** Shown in place of the summary when there is genuinely nothing yet. */
  emptyText?: string;
  isEmpty?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Could not load this section.';
}

// G1 (D-058) — the single shell every clinical section renders through.
//
// It exists so "consistent" is structural rather than five components each
// remembering to look the same: one place decides how a section title, count,
// collapsed summary, primary action and empty/loading/error/permission state
// are presented. The four equal-height dashboard cards it replaces gave every
// section the same visual weight regardless of what it held, which is what
// made the record read as a dashboard rather than a consultation.
//
// Full width and content-height by design: a section must never impose a
// fixed height or an internal scrollbar, and must never take space from the
// clinical note (whose height is declared independently — G0a, D-054).
export function ClinicalSection({
  title,
  count,
  summary,
  status,
  primaryAction,
  secondaryActions,
  isLoading,
  error,
  emptyText,
  isEmpty,
  expanded,
  onToggle,
  children,
}: ClinicalSectionProps) {
  const disabled = Boolean(primaryAction?.disabledReason);

  const actionButton = primaryAction ? (
    <Button
      className="kw-section-action"
      size="middle"
      type="default"
      disabled={disabled}
      onClick={(event) => {
        // The header row is the expand/collapse target; acting must not also
        // toggle the section underneath the doctor's finger.
        event.stopPropagation();
        primaryAction.onClick();
      }}
    >
      {primaryAction.label}
    </Button>
  ) : null;

  return (
    <section className="kw-clinical-section">
      <div
        className="kw-section-header"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="kw-section-heading">
          {expanded ? <DownOutlined /> : <RightOutlined />}
          <Text strong style={{ fontSize: 14 }}>
            {title}
            {count !== undefined && ` (${count})`}
          </Text>
          {status}
        </div>

        <div className="kw-section-summary">
          {isLoading ? (
            <Skeleton.Input active size="small" style={{ width: 220, height: 16 }} />
          ) : error ? (
            <Text type="danger" style={{ fontSize: 12 }}>
              {errorMessage(error)}
            </Text>
          ) : isEmpty ? (
            <Text type="secondary" italic style={{ fontSize: 12 }}>
              {emptyText ?? 'Nothing recorded'}
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {summary}
            </Text>
          )}
        </div>

        <Space size={4} className="kw-section-actions">
          {/* A disabled control explains itself — an action that simply does
              nothing when clicked reads as a bug. */}
          {disabled ? <Tooltip title={primaryAction?.disabledReason}>{actionButton}</Tooltip> : actionButton}
          {secondaryActions && secondaryActions.length > 0 && (
            <Dropdown menu={{ items: secondaryActions }} trigger={['click']}>
              <Button
                className="kw-section-action"
                size="middle"
                type="text"
                icon={<MoreOutlined />}
                aria-label={`More ${title} actions`}
                onClick={(event) => event.stopPropagation()}
              />
            </Dropdown>
          )}
        </Space>
      </div>

      {expanded && (
        <div className="kw-section-body">
          {error ? (
            <Alert type="error" showIcon message="This section could not be loaded" description={errorMessage(error)} />
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}

/**
 * "Amoxicillin, Cetirizine, Paracetamol +2 more" — the collapsed-summary
 * shape used by every section, in one place so the wording and the cut-off
 * cannot drift between them.
 */
export function summarise(values: string[], max = 3): string {
  if (values.length === 0) return '';
  const shown = values.slice(0, max).join(' · ');
  const rest = values.length - max;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}
