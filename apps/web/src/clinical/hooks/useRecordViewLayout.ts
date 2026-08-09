import { useCallback } from 'react';
import { useAuthStore } from '../../core/auth-store';
import {
  RecordViewLayout,
  selectLayout,
  useRecordViewLayoutStore,
} from '../record-view-layout-store';

/**
 * The Flow|Canvas preference for whoever is signed in.
 *
 * The one place that knows where the preference is stored. Callers get a
 * value and a setter and never touch the store, so moving this to a
 * server-side staff setting later changes this file and nothing else.
 */
export function useRecordViewLayout(): [RecordViewLayout, (layout: RecordViewLayout) => void] {
  const staffId = useAuthStore((state) => state.staff?.id);
  const layout = useRecordViewLayoutStore((state) => selectLayout(state, staffId));
  const setLayoutFor = useRecordViewLayoutStore((state) => state.setLayoutFor);

  const setLayout = useCallback(
    (next: RecordViewLayout) => setLayoutFor(staffId, next),
    [setLayoutFor, staffId],
  );

  return [layout, setLayout];
}
