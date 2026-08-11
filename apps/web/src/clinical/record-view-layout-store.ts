import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RecordViewLayout = 'canvas' | 'flow';

/**
 * Which record layout a member of staff works in — Flow (1.0's step-by-step
 * panels) or Canvas (2.0's single consult screen).
 *
 * PER STAFF MEMBER, not per browser. This used to be one value for the whole
 * browser profile, with a note saying to fix it once auth shipped. Auth
 * shipped (D-034), and a shared clinic desktop is the normal case in a
 * Malaysian GP practice: one machine in the consultation room, a doctor who
 * works in Canvas, a locum who prefers Flow, and an assistant who does
 * neither. One shared value meant each of them changed the layout for
 * everybody else, every time.
 *
 * The preference is keyed by staff id and still lives in this browser, so it
 * follows the person on this machine but not to another one. A server-side
 * setting is the eventual home; this store's shape is already the shape that
 * read would take, so wiring it is a swap in `useRecordViewLayout`, not a
 * rewrite of every caller.
 */
export const DEFAULT_RECORD_VIEW_LAYOUT: RecordViewLayout = 'flow';

interface RecordViewLayoutState {
  /** staffId -> chosen layout. A staff member with no entry gets the default. */
  byStaffId: Record<string, RecordViewLayout>;
  /** Signed-out or pre-auth reads and writes land here. */
  anonymous: RecordViewLayout;
  setLayoutFor: (staffId: string | undefined, layout: RecordViewLayout) => void;
}

export const useRecordViewLayoutStore = create<RecordViewLayoutState>()(
  persist(
    (set) => ({
      byStaffId: {},
      anonymous: DEFAULT_RECORD_VIEW_LAYOUT,
      setLayoutFor: (staffId, layout) =>
        set((state) =>
          staffId
            ? { byStaffId: { ...state.byStaffId, [staffId]: layout } }
            : { anonymous: layout },
        ),
    }),
    {
      // A new key, not the old one: the previous value was a single layout
      // string for the whole browser and cannot be read as a per-staff map.
      // Everyone starts on the default once, rather than on a value that
      // silently belonged to whoever last used the machine.
      name: 'kuwick-record-view-layout-v2',
    },
  ),
);

/** The layout for a given staff member, falling back to the default. */
export function selectLayout(
  state: Pick<RecordViewLayoutState, 'byStaffId' | 'anonymous'>,
  staffId: string | undefined,
): RecordViewLayout {
  if (!staffId) return state.anonymous;
  return state.byStaffId[staffId] ?? DEFAULT_RECORD_VIEW_LAYOUT;
}
