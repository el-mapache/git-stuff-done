import { useCallback, useEffect, useRef } from 'react';

/**
 * Polls `callback` at `intervalMs`, but pauses when the browser tab is hidden
 * and fires an immediate call when the tab becomes visible again.
 */
export function useVisibilityPolling(callback: () => void, intervalMs: number) {
  const savedCallback = useRef(callback);
  useEffect(() => { savedCallback.current = callback; }, [callback]);

  const startInterval = useCallback(() => {
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return id;
  }, [intervalMs]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = startInterval();

    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
      } else {
        savedCallback.current();
        intervalId = startInterval();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [startInterval]);
}
