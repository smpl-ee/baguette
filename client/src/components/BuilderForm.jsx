import { useState, useEffect, useRef, useMemo } from 'react';
import { Github } from 'lucide-react';
import { apiFetch } from '../api.js';
import { usersService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import FileAttachmentPicker from './FileAttachmentPicker.jsx';
import SearchableSelect from './SearchableSelect.jsx';
import { isMobile } from '../utils/isMobile.js';

function parseRepoFullName(full) {
  if (!full) return { owner: '', name: '' };
  const i = full.indexOf('/');
  if (i === -1) return { owner: full, name: '' };
  return { owner: full.slice(0, i), name: full.slice(i + 1) };
}

export default function BuilderForm({ onSubmit, loading, repoFullName, defaultPrompt }) {
  const { user } = useAuth();
  const persistentState = usePersistentState(`builder-form-${repoFullName}`);
  const [branch, setBranch] = persistentState.useState('branch', '');
  const [initialPrompt, setInitialPrompt] = persistentState.useState('prompt', defaultPrompt || '');
  const [showMore, setShowMore] = persistentState.useState('showMore', false);
  const [continueExistingBranch, setContinueExistingBranch] = useState(false);
  const { repos } = useRepoContext();
  const [permissionMode, setPermissionMode] = persistentState.useState('permissionMode', 'default');
  const [model, setModel] = persistentState.useState('model', '');
  const [models, setModels] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const initialPromptRef = useRef(null);

  const selectedRepo = useMemo(
    () => repos.find((r) => r.full_name === repoFullName),
    [repos, repoFullName]
  );
  const {
    branches,
    loading: loadingBranches,
    clearCacheAndReload,
    clearingCache,
  } = useGetBranches(selectedRepo);

  useEffect(() => {
    setContinueExistingBranch(false);
  }, [repoFullName]);
  // Auto-select default branch when repo changes
  useEffect(() => {
    if (!repoFullName) {
      setBranch('');
      return;
    }
    if (loadingBranches) return;
    if (branch && branches.includes(branch)) return;
    const defaultBranch = selectedRepo?.default_branch || branches[0];
    if (defaultBranch) setBranch(defaultBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, selectedRepo?.default_branch, branches]);

  useEffect(() => {
    if (!user?.id) return;
    usersService
      .get(user.id)
      .then((d) => {
        if (d?.default_permission_mode && d.default_permission_mode !== 'plan') {
          setPermissionMode((prev) => (prev === 'default' ? d.default_permission_mode : prev));
        }
        if (d?.model) {
          setModel((prev) => prev || d.model);
        }
      })
      .catch(() => {});
    apiFetch('/api/settings/models')
      .then((d) => setModels(d.models || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const canSubmit = !loading && repoFullName && branch && initialPrompt;

  useEffect(() => {
    if (!initialPromptRef.current) return;
    const el = initialPromptRef.current;
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight);
    el.style.height = Math.min(el.scrollHeight, lineHeight * 20) + 'px';
  }, [initialPrompt]);

  const clearForm = () => {
    persistentState.clear();
    setContinueExistingBranch(false);
    setFiles([]);
    setFileError(null);
  };

  const handleStart = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      repoFullName,
      branch,
      initialPrompt,
      files,
      permissionMode,
      planMode: false,
      model: model || undefined,
      continueExistingBranch,
    });
    clearForm();
  };

  const handlePlan = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      repoFullName,
      branch,
      initialPrompt,
      files,
      permissionMode,
      planMode: true,
      model: model || undefined,
      continueExistingBranch,
    });
    clearForm();
  };

  const handleKeyDown = (e) => {
    if (!isMobile() && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) {
        onSubmit({
          repoFullName,
          branch,
          initialPrompt,
          files,
          permissionMode,
          planMode: false,
          model: model || undefined,
          continueExistingBranch,
        });
        clearForm();
      }
    }
  };

  const handleAddFiles = (picked) => {
    setFileError(null);
    setFiles((prev) => [...prev, ...picked]);
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const { owner: repoOwner, name: repoName } = parseRepoFullName(repoFullName);

  return (
    <form onSubmit={handleStart} className="space-y-4">
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-300">
            {continueExistingBranch ? 'Branch to continue' : 'Base branch'}
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchableSelect
                value={branch}
                onChange={setBranch}
                options={branches}
                loading={loadingBranches}
                disabled={!repoFullName}
                placeholder="Search branches..."
                loadingText="Loading branches..."
                emptyText="No branches found"
                disabledText="Select a repository first"
              />
            </div>
            <button
              type="button"
              onClick={() => clearCacheAndReload()}
              disabled={!repoFullName || loadingBranches || clearingCache}
              title="Clear cache and reload branches"
              className="shrink-0 self-start px-1 py-2.5 text-sm leading-none text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
            >
              ↺
            </button>
          </div>
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
          <Github className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          {repoFullName ? (
            <span className="min-w-0 truncate">
              <span className="text-zinc-500">{repoOwner}</span>
              <span className="text-zinc-600"> / </span>
              <span className="text-zinc-400">{repoName}</span>
            </span>
          ) : (
            <span className="text-zinc-600">No repository selected</span>
          )}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">Initial Prompt</label>
        <FileAttachmentPicker
          files={files}
          onAdd={handleAddFiles}
          onRemove={handleRemoveFile}
          error={fileError}
        >
          <textarea
            ref={initialPromptRef}
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 pr-9 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent overflow-y-auto resize-none"
            placeholder="Describe what you want Claude to do..."
            required
          />
        </FileAttachmentPicker>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showMore ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          More options
        </button>

        {showMore && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-3">
            <div className="sm:col-span-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={continueExistingBranch}
                  onChange={(e) => setContinueExistingBranch(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-600 text-amber-500 focus:ring-amber-500/50"
                />
                <span className="text-sm text-zinc-300">
                  <span className="font-medium text-zinc-200">Continue on this branch</span>
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    Do not create a new branch; use the selected branch as-is. If an open PR exists
                    for it, the session links to that PR.
                  </span>
                </span>
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Permission Mode
              </label>
              <select
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <option value="default">Ask for approval</option>
                <option value="acceptEdits">Accept Edits</option>
                <option value="bypassPermissions">Bypass All Permissions</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-5 py-2.5 rounded-md text-sm font-medium transition-colors"
        >
          {loading ? 'Creating...' : 'Start'}
        </button>
        <button
          type="button"
          onClick={handlePlan}
          disabled={!canSubmit}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 hover:text-white px-5 py-2.5 rounded-md text-sm font-medium transition-colors border border-zinc-700 disabled:border-zinc-700"
        >
          Plan
        </button>
      </div>
    </form>
  );
}
