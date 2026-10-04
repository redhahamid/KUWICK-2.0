import { createContext, type ReactNode } from 'react';
import type { TileTone } from '../../../design-system/tokens';

/**
 * WHICH TILE A PANEL WEARS BY DEFAULT.
 *
 * The canvas design puts a gradient icon tile beside every card title. Sixty
 * panels across HR and the portal would each have to name one, and most of
 * them would name the same one: the section they sit in. So the shell that
 * knows the section — the HR rail, the portal's tabs — provides it here, and
 * `PanelHead` reads it. A panel that wants its own passes `icon` and `tone`
 * instead, and a second heading inside one panel (`rule`) wears none.
 */
export interface SectionTile {
  tone: TileTone;
  icon: ReactNode;
}

export const SectionTileContext = createContext<SectionTile | null>(null);
