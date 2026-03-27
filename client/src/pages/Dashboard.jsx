import { useState, useEffect } from 'react';
import { Loader2, Archive } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sessionsService } from '../feathers.js';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import SessionCard from '../components/SessionCard.jsx';
import BuilderForm from '../components/BuilderForm.jsx';
import ReviewerForm from '../components/ReviewerForm.jsx';
import { apiFetch } from '../api.js';
import { fileToContentBlock } from '../utils/fileToContentBlock.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import NoReposCard from '../components/NoReposCard.jsx';
import { useFilters } from '../context/FilterContext.jsx';

const REPO_COLORS = [
  'bg-amber-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-orange-500',
  'bg-teal-500',
  'bg-indigo-500',
];

function UsageGraph({ repoFilter }) {
  const [byDay, setByDay] = useState(null);
  const [byRepo, setByRepo] = useState(null);

  useEffect(() => {
    apiFetch('/api/usage/by-day')
      .then(setByDay)
      .catch(() => {});
    apiFetch('/api/usage/by-repo')
      .then(setByRepo)
      .catch(() => {});
  }, []);

  const filteredByRepo = byRepo
    ? repoFilter
      ? byRepo.filter((r) => r.repo_full_name === repoFilter)
      : byRepo
    : null;

  const total = filteredByRepo ? filteredByRepo.reduce((sum, r) => sum + r.total_cost_usd, 0) : 0;
  if ((!byDay || byDay.length === 0) && (!filteredByRepo || filteredByRepo.length === 0))
    return null;
  if (total === 0 && (!byDay || byDay.length === 0)) return null;

  const maxDay = byDay && byDay.length > 0 ? Math.max(...byDay.map((d) => d.cost_usd)) : 0;

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push(d.toISOString().slice(0, 10));
  }
  const dayMap = Object.fromEntries((byDay ?? []).map((r) => [r.day, r.cost_usd]));

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 mb-4 sm:mb-6 space-y-4">
      {maxDay > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400">
              Cost per day <span className="text-zinc-600 font-normal">(last 30d)</span>
            </span>
            <span className="text-xs text-zinc-500">${total.toFixed(2)} total</span>
          </div>
          <div className="flex items-end gap-px h-10">
            {days.map((day) => {
              const cost = dayMap[day] ?? 0;
              const pct = maxDay > 0 ? (cost / maxDay) * 100 : 0;
              return (
                <div
                  key={day}
                  className="flex-1 bg-amber-500/70 rounded-sm min-h-px transition-all hover:bg-amber-400"
                  style={{ height: `${Math.max(pct, cost > 0 ? 4 : 0)}%` }}
                  title={`${day}: $${cost.toFixed(4)}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {filteredByRepo && filteredByRepo.length > 0 && total > 0 && (
        <div>
          <div className="flex h-2 rounded-full overflow-hidden gap-px mb-2.5">
            {filteredByRepo.map((r, i) => (
              <div
                key={r.repo_full_name}
                className={`${REPO_COLORS[i % REPO_COLORS.length]} transition-all`}
                style={{ width: `${(r.total_cost_usd / total) * 100}%` }}
                title={`${r.repo_full_name}: $${r.total_cost_usd.toFixed(3)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {filteredByRepo.map((r, i) => (
              <div key={r.repo_full_name} className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${REPO_COLORS[i % REPO_COLORS.length]}`}
                />
                <span className="text-xs text-zinc-400 truncate max-w-48">{r.repo_full_name}</span>
                <span className="text-xs text-zinc-600">${r.total_cost_usd.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [lastParams, setLastParams] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const { sessions, loading, hasMore, loadMore } = useSessionsContext();
  const { repos, loading: loadingRepos, selectedRepo, setSelectedRepo } = useRepoContext();

  const persistentDash = usePersistentState('dashboard');
  const [agentType, setAgentType] = persistentDash.useState('agentType', 'builder');
  const { showArchived, setShowArchived } = useFilters();

  const [initDefaults, setInitDefaults] = useState(() => location.state ?? {});
  const { initRepo, initPrompt } = initDefaults;

  useEffect(() => {
    if (initRepo) setSelectedRepo(initRepo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initRepo]);

  const handleCreate = async ({
    repoFullName,
    branch,
    initialPrompt,
    files,
    permissionMode,
    planMode,
    model,
    createNewBranch,
    autoCreatePR,
    autoPush,
  }) => {
    const params = {
      repo_full_name: repoFullName,
      base_branch: branch,
      initial_prompt: initialPrompt,
      permission_mode: permissionMode,
      plan_mode: planMode,
      create_new_branch: createNewBranch ?? true,
      auto_create_pr: autoCreatePR ?? true,
      auto_push: autoPush ?? true,
    };
    if (model) params.model = model;
    if (files?.length) {
      try {
        params.initial_files = await Promise.all(files.map(fileToContentBlock));
      } catch (err) {
        setCreateError(err?.message ?? 'Failed to read attached files');
        return;
      }
    }
    setLastParams(params);
    setCreating(true);
    setCreateError(null);
    try {
      await sessionsService.create(params);
      setInitDefaults({});
      setFormKey((k) => k + 1);
      if (initRepo || initPrompt) {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setCreateError(err?.message ?? 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const handleCreateReviewer = async ({ repoFullName, prNumber, model, extraInstructions }) => {
    const params = {
      repo_full_name: repoFullName,
      agent_type: 'reviewer',
      pr_number: prNumber,
      base_branch: '',
      initial_prompt: extraInstructions
        ? `Please review PR #${prNumber}\n\n${extraInstructions}`
        : `Please review PR #${prNumber}`,
    };
    if (model) params.model = model;
    setLastParams(params);
    setCreating(true);
    setCreateError(null);
    try {
      await sessionsService.create(params);
      setFormKey((k) => k + 1);
    } catch (err) {
      setCreateError(err?.message ?? 'Failed to create review session');
    } finally {
      setCreating(false);
    }
  };

  const filteredSessions = sessions
    .filter((s) => showArchived || !s.archived_at)
    .filter((s) => !selectedRepo || s.repo_full_name === selectedRepo);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      <h1 className="text-base font-semibold text-white mb-5 font-display">Sessions</h1>

      <div className="relative bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
        {creating && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
              <p className="text-sm font-medium text-zinc-100">
                {agentType === 'reviewer'
                  ? 'Starting your review session…'
                  : 'Starting your Claude Code session…'}
              </p>
              <p className="text-xs text-zinc-400">This usually only takes a few seconds.</p>
            </div>
          </div>
        )}
        {createError && (
          <div className="mb-4 bg-red-900/30 border border-red-700 rounded-md px-3 sm:px-4 py-3 text-sm text-red-300">
            <div className="flex items-start justify-between gap-2">
              <p className="break-all">{createError}</p>
              <button
                onClick={() => setCreateError(null)}
                className="text-red-400 hover:text-red-200 shrink-0 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            {lastParams && (
              <button
                onClick={() =>
                  agentType === 'reviewer'
                    ? handleCreateReviewer(lastParams)
                    : handleCreate(lastParams)
                }
                disabled={creating}
                className="mt-2 bg-red-800/50 hover:bg-red-700/50 disabled:opacity-50 text-red-200 px-3 py-1 rounded text-xs font-medium transition-colors"
              >
                {creating ? 'Retrying...' : 'Retry'}
              </button>
            )}
          </div>
        )}

        {!loadingRepos && repos.length === 0 ? (
          <NoReposCard />
        ) : (
          <>
            {/* Agent type tabs */}
            <div className="flex gap-1 mb-4 bg-zinc-800/50 rounded-md p-0.5 w-fit">
              <button
                onClick={() => setAgentType('builder')}
                className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${
                  agentType === 'builder'
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Builder
              </button>
              <button
                onClick={() => setAgentType('reviewer')}
                className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${
                  agentType === 'reviewer'
                    ? 'bg-violet-600/60 text-violet-200'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Reviewer
              </button>
            </div>

            {agentType === 'builder' ? (
              <BuilderForm
                key={`builder-${formKey}`}
                onSubmit={handleCreate}
                loading={creating}
                repoFullName={selectedRepo}
                defaultPrompt={initPrompt || ''}
              />
            ) : (
              <ReviewerForm
                key={`reviewer-${formKey}`}
                onSubmit={handleCreateReviewer}
                loading={creating}
                repoFullName={selectedRepo}
              />
            )}
          </>
        )}
      </div>

      <UsageGraph repoFilter={selectedRepo} />

      <div className="flex justify-end mb-3">
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
          className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100 transition-colors"
        >
          <Archive className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>Show archived</span>
          <span
            className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${showArchived ? 'bg-amber-500' : 'bg-zinc-600'}`}
            aria-hidden
          >
            <span
              className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${showArchived ? 'translate-x-3' : 'translate-x-0'}`}
            />
          </span>
        </button>
      </div>

      <div className="space-y-3">
        {loading && sessions.length === 0 && (
          <p className="text-zinc-500 text-center py-12">Loading sessions...</p>
        )}
        {!loading && filteredSessions.length === 0 && sessions.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3 opacity-50">
            <img src="/baguette.svg" alt="" className="w-10 h-10" />
            <p className="text-zinc-500 text-sm">No sessions yet. Create one to get started.</p>
          </div>
        )}
        {!loading && filteredSessions.length === 0 && sessions.length > 0 && selectedRepo && (
          <div className="flex flex-col items-center py-12 gap-2 opacity-50">
            <p className="text-zinc-500 text-sm">
              No sessions for {selectedRepo.split('/')[1] ?? selectedRepo}.
            </p>
          </div>
        )}
        {filteredSessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
        {hasMore && (
          <button
            onClick={loadMore}
            className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
