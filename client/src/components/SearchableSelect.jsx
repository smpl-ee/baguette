import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from '../hooks/useDebouncedCallback.js';

const COLOR_CLASSES = {
  amber: { ring: 'focus:ring-amber-500/50', border: 'border-amber-500/50' },
  violet: { ring: 'focus:ring-violet-500/50', border: 'border-violet-500/50' },
};

/**
 * Keeps only loader rows that produce a stable non-empty key and a readable label.
 * Drops non-arrays, nullish items, duplicates (by string key), and rows where
 * getOptionValue / getOptionLabel throw.
 */
function sanitizeAsyncOptions(list, getOptionValue, getOptionLabel) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (item == null) continue;
    let keyRaw;
    try {
      keyRaw = getOptionValue(item);
    } catch {
      continue;
    }
    if (keyRaw == null) continue;
    const keyStr = String(keyRaw).trim();
    if (!keyStr) continue;
    if (seen.has(keyStr)) continue;
    try {
      void getOptionLabel(item);
    } catch {
      continue;
    }
    seen.add(keyStr);
    out.push(item);
  }
  return out;
}

/**
 * Searchable select with a text input for filtering and a dropdown list.
 *
 * Props:
 *   value            – currently selected value (from getOptionValue)
 *   onChange(value)  – called with getOptionValue(option) on select, or '' on clear
 *   options          – static options (ignored when getOptions is set)
 *   getOptions       – optional async (query: string) => options; enables server-side
 *                      search with debouncing; query is the current input (may be '').
 *                      Should return an array; invalid rows (bad shape, duplicate keys,
 *                      getOptionValue/getOptionLabel errors) are dropped.
 *   getOptionsDebounceMs – debounce for getOptions when query is non-empty (default 300)
 *   asyncRefetchKey  – when getOptions is set, changing this value refetches the open panel (e.g. org id)
 *   loading          – external loading (e.g. parent fetching); combined with internal fetch state
 *   disabled         – disable input entirely
 *   color            – 'amber' | 'violet' (default 'amber')
 *   placeholder      – input placeholder when idle
 *   loadingText      – placeholder while loading
 *   emptyText        – placeholder when options is empty (and not loading)
 *   disabledText     – placeholder when disabled
 *   getOptionValue   – (option) => string key — default: identity (for string arrays)
 *   getOptionLabel   – (option) => string for filtering — default: String(option)
 *   renderOption     – (option) => ReactNode for dropdown row — default: getOptionLabel
 *   renderSelected   – (option) => ReactNode for selected display — default: getOptionLabel
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  getOptions,
  getOptionsDebounceMs = 300,
  asyncRefetchKey,
  loading = false,
  disabled = false,
  color = 'amber',
  placeholder = 'Search...',
  loadingText = 'Loading...',
  emptyText = 'No options',
  disabledText,
  getOptionValue = (o) => o,
  getOptionLabel = (o) => String(o),
  renderOption,
  renderSelected,
}) {
  const [search, setSearch] = useState(null); // null means search is closed
  const [fetchedOptions, setFetchedOptions] = useState([]);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const requestIdRef = useRef(0);
  const getOptionsRef = useRef(getOptions);
  const getOptionValueRef = useRef(getOptionValue);
  const getOptionLabelRef = useRef(getOptionLabel);
  const { ring, border } = COLOR_CLASSES[color] ?? COLOR_CLASSES.amber;

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
      setFetchedOptions(
        sanitizeAsyncOptions(list, getOptionValueRef.current, getOptionLabelRef.current)
      );
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

  /** When the parent scope changes (e.g. selected org), refetch the open panel — keyed, not getOptions reference. */
  useEffect(() => {
    if (!getOptions || asyncRefetchKey === undefined || search === null) return;
    cancelDebouncedFetch();
    void fetchForQuery(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only when asyncRefetchKey changes
  }, [asyncRefetchKey]);

  const listSource = getOptions ? fetchedOptions : options;
  /** Parent-driven loading only — never tie this to async fetches: disabling the input steals focus. */
  const inputDisabled = disabled || loading;
  const showLoadingPlaceholder = loading || (getOptions && asyncLoading);

  const filteredOptions = getOptions
    ? listSource
    : listSource.filter(
        (o) => !search || getOptionLabel(o).toLowerCase().includes(search.toLowerCase())
      );

  const selectedItem = value ? listSource.find((o) => getOptionValue(o) === value) : null;

  useEffect(() => {
    if (search === null) return;

    const onMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setSearch(null);
        cancelDebouncedFetch();
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [search, cancelDebouncedFetch]);

  const inputPlaceholder =
    disabled && disabledText
      ? disabledText
      : showLoadingPlaceholder
        ? loadingText
        : listSource.length === 0
          ? emptyText
          : placeholder;

  const showClosedSelected = search === null && (selectedItem || value);

  const renderSelectedContent = () => {
    if (selectedItem) {
      return renderSelected ? renderSelected(selectedItem) : getOptionLabel(selectedItem);
    }
    return String(value);
  };

  const openSearchAndFocus = () => {
    setSearch('');
    if (getOptions) {
      cancelDebouncedFetch();
      void fetchForQuery('');
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputChange = (next) => {
    setSearch(next);
    if (!getOptions) return;
    if (next === '') {
      cancelDebouncedFetch();
      void fetchForQuery('');
    } else {
      debouncedFetch(next);
    }
  };

  return (
    <div ref={rootRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={search ?? ''}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (search !== null) return;
            setSearch('');
            if (getOptions) {
              cancelDebouncedFetch();
              void fetchForQuery('');
            }
          }}
          onClick={() => {
            if (search === null) {
              setSearch('');
              if (getOptions) {
                cancelDebouncedFetch();
                void fetchForQuery('');
              }
            }
          }}
          placeholder={inputPlaceholder}
          disabled={inputDisabled}
          className={`w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 ${ring} disabled:opacity-50 ${
            showClosedSelected
              ? 'absolute inset-0 z-0 min-h-10.5 opacity-0 pointer-events-none'
              : 'relative'
          }`}
        />
        {showClosedSelected &&
          (disabled ? (
            <div
              className={`relative z-10 w-full rounded-md border ${border} bg-zinc-800 px-3 py-2.5 text-sm text-white opacity-50`}
            >
              {renderSelectedContent()}
            </div>
          ) : (
            <button
              type="button"
              onClick={openSearchAndFocus}
              className={`relative z-10 w-full rounded-md border ${border} bg-zinc-800 px-3 py-2.5 text-sm text-white text-left cursor-pointer focus:outline-none focus:ring-2 ${ring}`}
              aria-label="Change selection"
            >
              {renderSelectedContent()}
            </button>
          ))}
      </div>
      <div
        className={`mt-1 max-h-48 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700/50 ${
          search === null ? 'hidden' : ''
        }`}
      >
        {!disabled &&
          !loading &&
          filteredOptions.map((o) => (
            <button
              key={getOptionValue(o)}
              type="button"
              onClick={() => {
                onChange(getOptionValue(o));
                setSearch(null);
                cancelDebouncedFetch();
              }}
              className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-zinc-700 transition-colors"
            >
              {renderOption ? renderOption(o) : getOptionLabel(o)}
            </button>
          ))}
      </div>
    </div>
  );
}
