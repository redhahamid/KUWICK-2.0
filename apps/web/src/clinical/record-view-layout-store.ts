import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RecordViewLayout = 'canvas' | 'flow';

// Per-browser preference for how the Patient Dashboard's clinical record
// tabs render — "Flow" switches one panel at a time (current default,
// friendlier on narrow/mobile viewports per dev feedback); "Canvas" stacks
// every section on one scrollable page (fewer clicks, better for desktop
// power users). No real user session exists yet (D-017), so this persists
// per-browser the same way the tenant ID does, not per-staff-account —
// swap for a real per-user setting once auth ships.
interface RecordViewLayoutState {
  layout: RecordViewLayout;
  setLayout: (layout: RecordViewLayout) => void;
}

export const useRecordViewLayoutStore = create<RecordViewLayoutState>()(
  persist(
    (set) => ({
      layout: 'flow',
      setLayout: (layout) => set({ layout }),
    }),
    { name: 'kuwick-record-view-layout' },
  ),
);
