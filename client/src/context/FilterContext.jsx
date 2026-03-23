import { createContext, useContext } from 'react';
import { usePersistentState } from '../hooks/usePersistentState.js';

const FilterContext = createContext(null);

export function FilterProvider({ children }) {
  const persistent = usePersistentState('filters');
  const [showArchived, setShowArchived] = persistent.useState('showArchived', false);

  return (
    <FilterContext.Provider value={{ showArchived, setShowArchived }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  return useContext(FilterContext);
}
