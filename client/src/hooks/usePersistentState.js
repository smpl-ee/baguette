import { useState, useCallback, useEffect, useRef } from 'react';

function readFromStorage(key) {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

export function usePersistentState(storageKey) {
  const [store, setStore] = useState(() => readFromStorage(storageKey));
  const prevKeyRef = useRef(storageKey);

  useEffect(() => {
    if (storageKey !== prevKeyRef.current) {
      prevKeyRef.current = storageKey;
      setStore(readFromStorage(storageKey));
    }
  }, [storageKey]);

  // Returns [value, setter] — like useState but backed by localStorage under storageKey.fieldKey
  const makeField = (fieldKey, defaultValue) => {
    const value = fieldKey in store ? store[fieldKey] : defaultValue;
    const setValue = (newValue) => {
      setStore((prev) => {
        const resolved =
          typeof newValue === 'function' ? newValue(prev[fieldKey] ?? defaultValue) : newValue;
        const next = { ...prev, [fieldKey]: resolved };
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {}
        }
        return next;
      });
    };
    return [value, setValue];
  };

  const clear = useCallback(() => {
    setStore({});
    if (storageKey) localStorage.removeItem(storageKey);
  }, [storageKey]);

  return { useState: makeField, clear };
}
