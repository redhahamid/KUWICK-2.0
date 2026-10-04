import { useContext, type ReactNode } from 'react';
import { IconTile } from '../../../design-system/components/IconTile';
import type { TileTone } from '../../../design-system/tokens';
import { SectionTileContext } from './sectionTile';

/** A white card with a hairline and the kit's one shadow. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `hr-panel ${className}` : 'hr-panel'}>{children}</section>;
}

/**
 * The panel's own heading row: the section's tile, what this is, one
 * sentence about it, and whatever you can do to it — pushed right so the
 * sentence keeps its width.
 *
 * The tile comes from the section the shell says we are in (`SectionTileContext`)
 * unless the panel names its own with `icon` and `tone`. A heading with
 * `rule` — the second and later sections of one panel — wears none: one tile
 * per card, the way the canvas design draws it.
 */
export function PanelHead({
  title,
  sub,
  actions,
  rule,
  icon,
  tone,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** A hairline above: the second and later sections of one panel. */
  rule?: boolean;
  /** This panel's own glyph, in place of the section's. */
  icon?: ReactNode;
  tone?: TileTone;
}) {
  const section = useContext(SectionTileContext);
  const glyph = icon ?? section?.icon ?? null;
  const tile = !rule && glyph ? <IconTile tone={tone ?? section?.tone ?? 'indigo'}>{glyph}</IconTile> : null;
  return (
    <div className={rule ? 'hr-panelHead hr-panelHead--rule' : 'hr-panelHead'}>
      <div className="hr-panelHead__title">
        {tile}
        <div>
          <h2>{title}</h2>
          {sub ? <div className="hr-sub">{sub}</div> : null}
        </div>
      </div>
      {actions ? <div className="hr-panelHead__actions">{actions}</div> : null}
    </div>
  );
}
