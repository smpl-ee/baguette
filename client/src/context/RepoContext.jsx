import { createContext, useContext, useEffect } from 'react';
import { useGetRepos } from '../hooks/useGetRepos.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import { useSessionsContext } from './SessionsContext.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

const RepoContext = createContext(null);

export function RepoProvider({ children }) {
  const { user } = useAuth();
  const { repos, loading, refetch } = useGetRepos(!!user);
  const { sessions } = useSessionsContext();
  const persistent = usePersistentState('dashboard');
  const [selectedRepo, setSelectedRepo] = persistent.useState('selectedRepo', null);

  // Drop persisted selection if that repo was removed / is no longer available
  useEffect(() => {
    if (loading || !selectedRepo) return;
    const exists = repos.some((r) => r.full_name === selectedRepo);
    if (!exists) setSelectedRepo(null);
  }, [loading, repos, selectedRepo, setSelectedRepo]);

  // Auto-select when none chosen (incl. after stale selection cleared)
  useEffect(() => {
    if (selectedRepo) return;
    if (loading || repos.length === 0) return;
    setSelectedRepo(repos[0].full_name);
  }, [loading, repos, selectedRepo, sessions, setSelectedRepo]);

  return (
    <RepoContext.Provider value={{ repos, loading, refetch, selectedRepo, setSelectedRepo }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useRepoContext() {
  return useContext(RepoContext);
}
