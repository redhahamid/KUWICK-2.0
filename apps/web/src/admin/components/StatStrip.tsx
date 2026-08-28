import { ReactNode } from 'react';
import { Tooltip } from 'antd';

export interface Stat {
  label: string;
  value: ReactNode;
  /** A secondary line — a comparison, a count, a caveat. */
  hint?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  /** Shown on hover. For the sentence a number needs but the strip has no room for. */
  explain?: string;
}

/**
 * THE HEADLINE NUMBERS, as a strip rather than a row of cards.
 *
 * Six antd `Card`s in a `Row` is what the existing reports do and it costs
 * roughly 180px of vertical space to say six numbers. This says them in about
 * 70, which is the difference between seeing the KPIs and the work queue
 * together and having to scroll between them.
 */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="kw-statStrip" role="group">
      {stats.map((stat) => {
        const body = (
          <div className={`kw-stat kw-stat--${stat.tone ?? 'neutral'}`} key={stat.label}>
            <span className="kw-stat__label">{stat.label}</span>
            <span className="kw-stat__value">{stat.value}</span>
            {stat.hint ? <span className="kw-stat__hint">{stat.hint}</span> : null}
          </div>
        );
        return stat.explain ? (
          <Tooltip key={stat.label} title={stat.explain} placement="bottom">
            {body}
          </Tooltip>
        ) : (
          body
        );
      })}
    </div>
  );
}

/**
 * THE EXCEPTION TILES — "what requires attention today".
 *
 * The brief's hierarchy is Summary → Exceptions → Work queue → Detail, and this
 * is the second step. A tile with a zero count is rendered QUIET rather than
 * hidden: "nothing expired" is information, and a tile that disappears when it
 * is clean teaches people not to look for it.
 */
export interface ExceptionTile {
  key: string;
  label: string;
  /**
   * How many things need attention. A tile reading `0` is CLEAN and renders
   * quiet — which is why an amount must never be passed here: `RM569.10`
   * rounded into this slot reads as 569 invoices, and an amount that happens
   * to be zero would paint a tile green while somebody is owed nothing yet.
   */
  count: number;
  /**
   * What the tile SHOWS, when that is not the count — a money total on an
   * aging bucket. `count` still decides the tone, so a bucket holding
   * RM84.80 across one invoice is styled as one thing to chase.
   */
  display?: string;
  tone?: 'bad' | 'warn' | 'info';
  hint?: string;
  onSelect?: () => void;
}

export function ExceptionTiles({ tiles, selected }: { tiles: ExceptionTile[]; selected?: string }) {
  return (
    <div className="kw-exceptionTiles">
      {tiles.map((tile) => {
        const clean = tile.count === 0;
        return (
          <button
            key={tile.key}
            type="button"
            className={[
              'kw-exceptionTile',
              clean ? 'kw-exceptionTile--clean' : `kw-exceptionTile--${tile.tone ?? 'warn'}`,
              selected === tile.key ? 'kw-exceptionTile--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={tile.onSelect}
            disabled={!tile.onSelect}
            title={tile.hint}
          >
            <span className="kw-exceptionTile__count">{tile.display ?? tile.count}</span>
            <span className="kw-exceptionTile__label">{tile.label}</span>
          </button>
        );
      })}
    </div>
  );
}
