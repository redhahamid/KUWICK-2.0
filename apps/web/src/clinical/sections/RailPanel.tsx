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

  /**
   * b4 PIECE 1 — AN EMPTY CARD COSTS ONE LINE.
   *
   * "Direct Services (0)" used to spend a heading, a search box and an
   * italic "nothing recorded" — three lines and a control, before anything
   * existed. On a first visit that is four cards' worth of nothing pushing the
   * one card with content off the bottom of a 1366px screen.
   *
   * Collapsed means the count and the add affordance share the header line.
   * It is NOT collapsed-by-default in the toggle sense: there is nothing to
   * expand, no click reveals hidden clinical content, and the moment a first
   * item exists the card opens on its own.
   */
  const isEmpty = !isLoading && !error && items.length === 0;

  return (
    <section
      className={`kw-rail-panel${isEmpty ? ' kw-rail-panel-empty' : ''}`}
      data-panel={title}
      data-empty={isEmpty ? 'true' : undefined}
      id={anchorId}
    >
      <div className="kw-rail-head">
        <Space size={6} align="center">
          <Text strong style={{ fontSize: 14 }}>
            {title}
            {count !== undefined && ` (${count})`}
          </Text>
          {status}
          {/* The wording survives the collapse — it just stops owning a line
              of its own. On a card with nothing in it there is room beside
              the count. */}
          {isEmpty && emptyText && (
            <Text type="secondary" italic style={{ fontSize: 12 }}>
              {emptyText}
            </Text>
          )}
        </Space>
      </div>

      {banner}

      {/* ONE DOM POSITION, always. An earlier attempt moved this control into
          the header while the card was empty, which unmounted and remounted the
          search box the moment the first item loaded — dropping focus in the
          middle of typing a drug name. The empty card collapses to one line
          through LAYOUT instead (see `.kw-rail-panel-empty`), so nothing moves
          in the tree. */}
      {addControl && <div className="kw-rail-add">{addControl}</div>}

      <div className="kw-rail-body">
        {isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : error ? (
          <Alert type="error" showIcon message="Could not be loaded" description={errorMessage(error)} />
        ) : items.length === 0 ? null : (
          <>
            {visible}
            {hidden > 0 && !showAll && (
              <Button type="link" size="small" className="kw-rail-more" onClick={() => setShowAll(true)}>
                {/* The REMAINDER collapses, never the list. Same rule as the
                    header alert chip: a doctor scanning a rail must be able to
                    see that there are eight medications without clicking. */}
                +{hidden} more
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
