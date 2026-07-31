import { useEffect, useState } from 'react';

// Plain window.matchMedia — no CSS-in-JS/media-query library in this
// project, and Canvas layout's viewport-fill math (PatientDashboardPage)
// needs a JS boolean to decide "fit exactly, no scroll" (desktop) vs.
// "stack and let the page scroll" (mobile/tablet), which inline styles
// alone can't branch on.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const listener = () => setMatches(mediaQueryList.matches);
    listener();
    mediaQueryList.addEventListener('change', listener);
    return () => mediaQueryList.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

// Matches antd's `lg` breakpoint — Canvas's fixed-height, side-by-side
// layout only makes sense at desktop widths.
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 992px)');
}
