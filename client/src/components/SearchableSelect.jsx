import { useEffect, useRef, useState } from 'react';

const COLOR_CLASSES = {
  amber: { ring: 'focus:ring-amber-500/50', border: 'border-amber-500/50' },
  violet: { ring: 'focus:ring-violet-500/50', border: 'border-violet-500/50' },
};

/**
 * Searchable select with a text input for filtering and a dropdown list.
 *
 * Props:
 *   value            – currently selected value (from getOptionValue)
 *   onChange(value)  – called with getOptionValue(option) on select, or '' on clear
 *   options          – array of options (strings or objects)
 *   loading          – show loading placeholder and disable input
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
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const { ring, border } = COLOR_CLASSES[color] ?? COLOR_CLASSES.amber;

  useEffect(() => {
    if (search === null) return;

    const onMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setSearch(null);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [search]);

  const selectedItem = value ? options.find((o) => getOptionValue(o) === value) : null;

  const filteredOptions = options.filter(
    (o) => !search || getOptionLabel(o).toLowerCase().includes(search.toLowerCase())
  );

  const inputPlaceholder =
    disabled && disabledText
      ? disabledText
      : loading
        ? loadingText
        : options.length === 0
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
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div ref={rootRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={search ?? ''}
          onChange={(e) => setSearch(e.target.value)}
          onClick={() => {
            if (search === null) setSearch('');
          }}
          placeholder={inputPlaceholder}
          disabled={disabled || loading}
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
