import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/** Scrolls to the top when the path changes (not on query-string changes like ?category=). */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      window.scrollTo(0, 0);
    } catch {
      // Some test environments don't implement scrolling.
    }
  }, [pathname]);

  return null;
}
