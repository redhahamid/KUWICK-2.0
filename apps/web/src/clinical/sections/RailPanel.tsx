import { ReactNode, useState } from 'react';
import { Alert, Button, Skeleton, Space, Typography } from 'antd';

const { Text } = Typography;

export interface RailPanelProps {
  title: string;
  count?: number;
  /** A badge beside the title — outstanding work, awaiting dispense. */
  status?: ReactNode;
  /** The inline add control. Always rendered; never a reveal. */
  addControl?: ReactNode;
  /**
   * KW2-C2 — a standing condition pinned above everything else in the card.
   *
   * Above `addControl` on purpose: the allergy strip has to be read BEFORE
   * the button that opens the prescribing form, not beside the list of what
   * was already prescribed. It also survives the empty state, which the body
   * below does not.
   */
  banner?: ReactNode;
  isLoading?: boolean;
  error?: unknown;
  emptyText?: string;
  /** How many rows to show before "View all N". */
  previewLimit: number;
  /** Already ordered by the caller — clinically, not by id. */
  items: ReactNode[];
  children?: ReactNode;
  /** Anchor target for the mobile quick-nav. */
  anchorId?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load this section.';
}

/**
 * G4.5b (D-071) — an always-open panel in the clinical rail.
 *
 * The shell it replaces (`ClinicalSection`) opened and closed, and its "+ Add"
 * button did not add anything — it expanded the section:
 *
 *     primaryAction={{ label: '+ Add Diagnosis', onClick: () => !expanded && onToggle() }}
 *
 * So every clinical action started with a click that revealed rather than did.
 * This panel has no collapsed state and no toggle: the current items and the
 * add control are on screen from the moment the record opens.
 *
 * Long lists truncate to `previewLimit` and offer "View all N", which expands
 * IN PLACE and lets the page grow. There is deliberately no internal
 * scrollbar: a scroller inside a rail beside a scrolling page is the trap
 * G0a removed, and it hides clinical content behind a gesture nobody makes.
 */
export function RailPanel({
  title,
  count,
  status,
  addControl,
  banner,
  isLoading,
  error,
  emptyText,
  previewLimit,
  items,
  children,
  anchorId,
}: RailPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const hidden = Math.max(items.length - previewLimit, 0);
  const visible = showAll ? items : items.slice(0, previewLimit);

  return (
    <section className="kw-rail-panel" data-panel={title} id={anchorId}>
      <div className="kw-rail-head">
        <Space size={6} align="center">
          <Text strong style={{ fontSize: 14 }}>
            {title}
            {count !== undefined && ` (${count})`}
          </Text>
          {status}
        </Space>
      </div>

      {banner}

      {addControl && <div className="kw-rail-add">{addControl}</div>}

      <div className="kw-rail-body">
        {isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : error ? (
          <Alert type="error" showIcon message="Could not be loaded" description={errorMessage(error)} />
        ) : items.length === 0 ? (
          <Text type="secondary" italic style={{ fontSize: 12 }}>
            {emptyText ?? 'Nothing recorded'}
          </Text>
        ) : (
          <>
            {visible}
            {hidden > 0 && !showAll && (
              <Button type="link" size="small" className="kw-rail-more" onClick={() => setShowAll(true)}>
                View all {items.length}
              </Button>
            )}
            {showAll && hidden > 0 && (
              <Button type="link" size="small" className="kw-rail-more" onClick={() => setShowAll(false)}>
                Show fewer
              </Button>
            )}
          </>
        )}
        {children}
      </div>
    </section>
  );
}
