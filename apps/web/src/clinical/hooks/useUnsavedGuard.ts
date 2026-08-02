import { useEffect } from 'react';

// C1 (D-052) — warn before the browser throws away unsaved clinical text.
//
// Covers refresh, tab close, and window close. The browser deliberately
// ignores custom wording here and shows its own generic prompt; that is a
// platform decision, not something worth fighting.
//
// In-app navigation (note switch, patient/visit change, leaving the route) is
// guarded separately with a real dialog, because there we can offer Save as
// well as Discard — which beforeunload cannot.
export function useBeforeUnloadGuard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers need returnValue set to trigger the prompt.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [enabled]);
}
