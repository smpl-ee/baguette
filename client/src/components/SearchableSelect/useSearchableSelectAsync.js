import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback.js';

/**
 * Async option loading for SearchableSelect: debounced fetch, stale-request guard,
 * refetch when asyncRefetchKey changes (panel open).
 */
export function useSearchableSelectAsync({
  getOptions,
  getOptionValue,
  getOptionLabel,
  getOptionsDebounceMs,
  asyncRefetchKey,
  search,
}) {
  const [fetchedOptions, setFetchedOptions] = useState([]);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const requestIdRef = useRef(0);
  const getOptionsRef = useRef(getOptions);
  const getOptionValueRef = useRef(getOptionValue);
  const getOptionLabelRef = useRef(getOptionLabel);

  useEffect(() => {
    getOptionsRef.current = getOptions;
    getOptionValueRef.current = getOptionValue;
    getOptionLabelRef.current = getOptionLabel;
  }, [getOptions, getOptionValue, getOptionLabel]);

  const fetchForQuery = useCallback(async (query) => {
    const loader = getOptionsRef.current;
    if (!loader) return;
    const id = ++requestIdRef.current;
    setAsyncLoading(true);
    try {
      const list = await loader(query);
      if (id !== requestIdRef.current) return;
      setFetchedOptions(list);
    } catch {
      if (id !== requestIdRef.current) return;
      setFetchedOptions([]);
    } finally {
      if (id === requestIdRef.current) setAsyncLoading(false);
    }
  }, []);

  const [debouncedFetch, cancelDebouncedFetch] = useDebouncedCallback((q) => {
    void fetchForQuery(q);
  }, getOptionsDebounceMs);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      cancelDebouncedFetch();
    };
  }, [cancelDebouncedFetch]);

  useEffect(() => {
    if (!getOptions || asyncRefetchKey === undefined || search === null) return;
    cancelDebouncedFetch();
    void fetchForQuery(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only when asyncRefetchKey changes
  }, [asyncRefetchKey]);

  return {
    fetchedOptions,
    asyncLoading,
    fetchForQuery,
    debouncedFetch,
    cancelDebouncedFetch,
  };
}
