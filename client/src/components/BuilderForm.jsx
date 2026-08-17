import { useState, useEffect, useRef, useMemo } from 'react';
import GithubIcon from './GithubIcon.jsx';
import { apiFetch } from '../api.js';
import { usersService, pluginsService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import FileAttachmentPicker from './FileAttachmentPicker.jsx';
import SearchableSelect from './SearchableSelect';
import { isMobile } from '../utils/isMobile.js';
import { variantLabel } from '../utils/models.js';

function parseRepoFullName(full) {
  if (!full) return { owner: '', name: '' };
  const i = full.indexOf('/');
  if (i === -1) return { owner: full, name: '' };
  return { owner: full.slice(0, i), name: full.slice(i + 1) };
}

export default function BuilderForm({ onSubmit, loading, repoFullName, defaultPrompt }) {
  const { user } = useAuth();
  const persistentState = usePersistentState(`builder-form-${repoFullName}`);
  const globalState = usePersistentState('builder-form-global');
  const [branch, setBranch] = persistentState.useState('branch', '');
  const [initialPrompt, setInitialPrompt] = persistentState.useState('prompt', defaultPrompt || '');
  const [showMore, setShowMore] = globalState.useState('showMore', false);
  const [createNewBranch, setCreateNewBranch] = persistentState.useState('createNewBranch', true);
  const [branchName, setBranchName] = persistentState.useState('branchName', '');
  const [autoPush, setAutoPush] = persistentState.useState('autoPush', true);
  const { repos } = useRepoContext();
  const [agentSdk, setAgentSdk] = globalState.useState('agentSdk', 'claude');
  const [model, setModel] = persistentState.useState('model', '');
  const [models, setModels] = useState([]);
  const [cursorVariantIdx, setCursorVariantIdx] = useState(null);
  const [selectedPlugins, setSelectedPlugins] = persistentState.useState('plugins', []);
  const [availablePlugins, setAvailablePlugins] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const initialPromptRef = useRef(null);
  const isCursor = agentSdk === 'cursor';

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

  const cursorDefaultModelRef = useRef('');
  const claudeDefaultModelRef = useRef('');
  const modelExplicitlySet = useRef(false);

  useEffect(() => {
    if (!user?.id) return;
    usersService
      .get(user.id)
      .then((d) => {
        if (d?.default_agent_sdk) {
          setAgentSdk((prev) => (prev === 'claude' ? d.default_agent_sdk : prev));
        }
        if (d?.model) {
          claudeDefaultModelRef.current = d.model;
          if (!modelExplicitlySet.current && !isCursor) setModel(d.model);
        }
        if (d?.cursor_model) {
          cursorDefaultModelRef.current = d.cursor_model;
          if (!modelExplicitlySet.current && isCursor) setModel(d.cursor_model);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const url = isCursor ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    setModels([]);
    modelExplicitlySet.current = false;
    apiFetch(url)
      .then((d) => {
        const loadedModels = d.models || [];
        setModels(loadedModels);
        setModel((prev) => {
          if (modelExplicitlySet.current) return prev;
          if (prev && loadedModels.some((m) => m.id === prev)) return prev;
          const pref = isCursor ? cursorDefaultModelRef.current : claudeDefaultModelRef.current;
          if (pref && loadedModels.some((m) => m.id === pref)) return pref;
          return loadedModels[0]?.id || '';
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSdk]);

  useEffect(() => {
    if (!isCursor) { setCursorVariantIdx(null); return; }
    const m = models.find((m) => m.id === model);
    const variants = m?.variants ?? [];
    const defaultIdx = variants.findIndex((v) => v.is_default);
    setCursorVariantIdx(variants.length > 0 ? (defaultIdx >= 0 ? defaultIdx : 0) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, models]);

  useEffect(() => {
    pluginsService
      .find()
      .then((d) => setAvailablePlugins(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

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
    setFiles([]);
    setFileError(null);
  };

  const buildPayload = ({ planMode }) => {
    const selectedModel = isCursor ? models.find((m) => m.id === model) : null;
    const selectedVariant =
      selectedModel?.variants != null && cursorVariantIdx != null
        ? selectedModel.variants[cursorVariantIdx]
        : null;
    const modelPayload = (() => {
      if (!model) return undefined;
      if (isCursor && selectedVariant?.params?.length) {
        return JSON.stringify({ id: model, params: selectedVariant.params });
      }
      return model;
    })();
    return {
      repoFullName,
      branch,
      initialPrompt,
      files,
      permissionMode: 'bypassPermissions',
      planMode,
      model: modelPayload,
      createNewBranch,
      branchName: branchName || undefined,
      autoPush,
      plugins: !isCursor && selectedPlugins.length > 0 ? selectedPlugins : undefined,
      agentSdk,
    };
  };

  const handleStart = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: false }))) clearForm();
  };

  const handlePlan = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (await onSubmit(buildPayload({ planMode: true }))) clearForm();
  };

  const handleKeyDown = async (e) => {
    if (!isMobile() && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit && (await onSubmit(buildPayload({ planMode: false })))) clearForm();
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
      <div className="flex items-center gap-1 p-0.5 bg-zinc-800 rounded-md w-fit">
        {['claude', 'cursor'].map((sdk) => (
          <button
            key={sdk}
            type="button"
            onClick={() => setAgentSdk(sdk)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${agentSdk === sdk ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            {sdk}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-300">Base branch</label>
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
          <GithubIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
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
            placeholder="Describe what you want the agent to do..."
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
            {createNewBranch && (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Branch name{' '}
                  <span className="text-zinc-500 font-normal">(optional, auto-generated if empty)</span>
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="my-feature-branch"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-transparent"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => { setModel(e.target.value); modelExplicitlySet.current = true; }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                {models.length === 0 && <option value="">Loading…</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
            {isCursor && (() => {
              const selectedModel = models.find((m) => m.id === model);
              const variants = selectedModel?.variants ?? [];
              return variants.length > 0 ? (
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Variant</label>
                  <select
                    value={cursorVariantIdx ?? 0}
                    onChange={(e) => setCursorVariantIdx(parseInt(e.target.value))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  >
                    {variants.map((v, i) => (
                      <option key={i} value={i}>
                        {variantLabel(v, selectedModel?.display_name)}
                        {v.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null;
            })()}

            {/* Plugins — Claude only */}
            {!isCursor && availablePlugins.length > 0 && (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Plugins</label>
                <div className="space-y-1.5">
                  {availablePlugins.map((plugin) => (
                    <label
                      key={plugin.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPlugins.includes(plugin.id)}
                        onChange={(e) =>
                          setSelectedPlugins((prev) =>
                            e.target.checked
                              ? [...prev, plugin.id]
                              : prev.filter((id) => id !== plugin.id)
                          )
                        }
                        className="mt-0.5 rounded border-zinc-600 text-amber-500 focus:ring-amber-500/50"
                      />
                      <span className="text-sm text-zinc-300 leading-tight">
                        <span className="font-medium text-zinc-200">{plugin.name}</span>
                        <span className="block text-xs font-normal text-zinc-500 mt-0.5">
                          {plugin.marketplace_repo} · {plugin.plugin_path}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={createNewBranch}
          onClick={() => setCreateNewBranch((v) => !v)}
          className="flex items-center gap-2 group"
        >
          <span
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${createNewBranch ? 'bg-amber-500' : 'bg-zinc-600'}`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${createNewBranch ? 'translate-x-3.5' : 'translate-x-0.5'}`}
            />
          </span>
          <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
            New branch
          </span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={autoPush}
          onClick={() => setAutoPush((v) => !v)}
          className="flex items-center gap-2 group"
        >
          <span
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${autoPush ? 'bg-amber-500' : 'bg-zinc-600'}`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${autoPush ? 'translate-x-3.5' : 'translate-x-0.5'}`}
            />
          </span>
          <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
            Auto-push
          </span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
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
      </div>
    </form>
  );
}
