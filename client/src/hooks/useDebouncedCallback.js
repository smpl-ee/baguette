import { useCallback, useEffect, useRef } from 'react';

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} delayMs
 * @returns {[debounced: F, cancel: () => void]}
 */
export function useDebouncedCallback(fn, delayMs) {
  const fnRef = useRef(fn);
  const idRef = useRef(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const cancel = useCallback(() => {
    if (idRef.current != null) {
      clearTimeout(idRef.current);
      idRef.current = null;
    }
  }, []);

  const debounced = useCallback(
    (...args) => {
      cancel();
      idRef.current = setTimeout(() => {
        idRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    },
    [cancel, delayMs]
  );

  useEffect(() => () => cancel(), [cancel]);

  return [debounced, cancel];
}
