import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toastError } from '../utils/toastError.jsx';
import { apiFetch } from '../api.js';
import { usersService, reposService, userReposService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { requestNotificationPermission } from '../utils/notifications.js';
import { useRepoContext } from '../context/RepoContext.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

// ─── RepoSearchInput ──────────────────────────────────────────────────────────

function RepoSearchInput({ value, onSelect, addedNames, trailing }) {
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('personal');
  const [orgRepos, setOrgRepos] = useState([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadReposForOrg = useCallback((org) => {
    setSelectedOrg(org);
    setLoading(true);
    setOrgRepos([]);
    reposService
      .findRemote({ org })
      .then((result) => setOrgRepos(result.repos))
      .catch((err) => toastError('Failed to load repositories', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reposService
      .findOrgs({})
      .then(setOrgs)
      .catch((err) => toastError('Failed to load organizations', err))
      .finally(() => setLoadingOrgs(false));
    loadReposForOrg('personal');
  }, [loadReposForOrg]);

  const handleRefresh = async () => {
    await reposService
      .refresh({})
      .catch((err) => toastError('Failed to refresh repositories', err));
    onSelect('');
    setRefreshKey((k) => k + 1);
    setLoadingOrgs(true);
    setOrgs([]);
    reposService
      .findOrgs({})
      .then(setOrgs)
      .catch((err) => toastError('Failed to load organizations', err))
      .finally(() => setLoadingOrgs(false));
    loadReposForOrg('personal');
  };

  const availableRepos = orgRepos.filter((r) => !addedNames.has(r.full_name));

  return (
    <div className="flex-1">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {loadingOrgs && <span className="text-xs text-zinc-600">Loading…</span>}
        {!loadingOrgs &&
          orgs.map((org) => (
            <button
              key={org.login}
              type="button"
              onClick={() => loadReposForOrg(org.login)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                selectedOrg === org.login
                  ? 'bg-amber-500 text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {org.name || org.login}
            </button>
          ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start min-w-0">
        <div className="flex-1 min-w-0">
          <SearchableSelect
            key={refreshKey}
            value={value}
            onChange={onSelect}
            options={availableRepos}
            loading={loading}
            placeholder="Search repositories…"
            loadingText="Loading repositories…"
            emptyText="No repositories found"
            getOptionValue={(r) => r.full_name}
            getOptionLabel={(r) => r.full_name}
            renderOption={(r) => (
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono truncate">{r.full_name}</span>
                {r.private && <span className="text-xs text-zinc-500 shrink-0">private</span>}
              </div>
            )}
            renderSelected={(r) => <span className="font-mono">{r.full_name}</span>}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || loadingOrgs}
            title="Clear cache and reload"
            className="inline-flex items-center justify-center text-zinc-500 hover:text-zinc-300 text-sm leading-none px-1 py-2.5 disabled:opacity-40"
          >
            ↺
          </button>
          {trailing}
        </div>
      </div>
    </div>
  );
}

// ─── RepositoriesTab ──────────────────────────────────────────────────────────

function RepositoriesTab({ settings, onSave }) {
  const { user } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();

  // GitHub token state
  const [usePatMode, setUsePatMode] = useState(false);
  const [githubToken, setGithubToken] = useState(null);
  const [githubTokenDirty, setGithubTokenDirty] = useState(false);
  const [savingGithub, setSavingGithub] = useState(false);
  const [savedGithub, setSavedGithub] = useState(false);
  const [githubError, setGithubError] = useState(null);

  useEffect(() => {
    if (!settings) return;
    setUsePatMode(!!settings.github_token);
    setGithubToken(null);
    setGithubTokenDirty(false);
  }, [settings]);

  const handleSaveGithub = async (e) => {
    e.preventDefault();
    setSavingGithub(true);
    setSavedGithub(false);
    setGithubError(null);
    try {
      const patch = {};
      if (githubTokenDirty) {
        patch.github_token = githubToken ?? '';
      } else if (!usePatMode && settings?.github_token) {
        patch.github_token = '';
      }
      const updated = await usersService.patch(user.id, patch);
      onSave(updated);
      setGithubToken(null);
      setGithubTokenDirty(false);
      setUsePatMode(!!updated.github_token);
      setSavedGithub(true);
      setTimeout(() => setSavedGithub(false), 2000);
    } catch (err) {
      setGithubError(err.message);
    } finally {
      setSavingGithub(false);
    }
  };

  // Repo state
  const [selectedRepo, setSelectedRepo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [unlinkingId, setUnlinkingId] = useState(null);
  const [confirmUnlink, setConfirmUnlink] = useState(null);

  // Per-repo API key state
  const [repoKeyEditingId, setRepoKeyEditingId] = useState(null);
  const [repoKeyValue, setRepoKeyValue] = useState(null);
  const [repoKeyDirty, setRepoKeyDirty] = useState(false);
  const [repoKeySaving, setRepoKeySaving] = useState(false);
  // Local override of anthropic_api_key per repo (after save, until refetch)
  const [repoKeyOverrides, setRepoKeyOverrides] = useState({});

  const handleRepoKeySave = async (repoId, userRepoId) => {
    setRepoKeySaving(true);
    try {
      const result = await userReposService.patch(userRepoId, {
        anthropic_api_key: repoKeyValue ?? '',
      });
      setRepoKeyOverrides((prev) => ({ ...prev, [repoId]: result.anthropic_api_key }));
      setRepoKeyEditingId(null);
      setRepoKeyValue(null);
      setRepoKeyDirty(false);
    } catch (err) {
      toastError('Failed to save API key', err);
    } finally {
      setRepoKeySaving(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!selectedRepo) return;
    setAdding(true);
    setAddResult(null);
    try {
      const result = await reposService.create({ fullName: selectedRepo });
      setSelectedRepo('');
      setAddResult(result);
      await refetchRepos();
    } catch (err) {
      toastError('Failed to add repository', err);
    } finally {
      setAdding(false);
    }
  };

  const handleUnlinkClick = (repo) => setConfirmUnlink(repo);
  const handleUnlinkCancel = () => setConfirmUnlink(null);

  const handleUnlinkConfirm = async () => {
    if (!confirmUnlink) return;
    setUnlinkingId(confirmUnlink.id);
    try {
      await reposService.unlink(confirmUnlink.id);
      setConfirmUnlink(null);
      await refetchRepos();
    } catch (err) {
      toastError('Failed to remove repository', err);
    } finally {
      setUnlinkingId(null);
    }
  };

  const addedNames = new Set(repos.map((r) => r.full_name));

  return (
    <div className="space-y-8">
      {/* GitHub connection */}
      <form onSubmit={handleSaveGithub} className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-300">GitHub Connection</h2>

        {githubError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
            {githubError}
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 space-y-4 max-w-xl">
          <div className="flex items-center gap-3">
            {user?.avatar_url && (
              <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium text-white">{user?.username}</p>
              <p className="text-xs text-zinc-500">Connected via GitHub OAuth</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Token for git operations
            </label>
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!usePatMode}
                  onChange={() => setUsePatMode(false)}
                  className="accent-amber-500"
                />
                <span className="text-sm text-zinc-300">OAuth token</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={usePatMode}
                  onChange={() => setUsePatMode(true)}
                  className="accent-amber-500"
                />
                <span className="text-sm text-zinc-300">Personal Access Token</span>
              </label>
            </div>
            {usePatMode && (
              <div>
                <MaskedSecretInput
                  maskedValue={settings?.github_token}
                  placeholder="github_pat_…"
                  onChange={(val, dirty) => {
                    setGithubToken(val);
                    setGithubTokenDirty(dirty);
                  }}
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Create a token at github.com/settings/tokens/new with{' '}
                  <code className="text-zinc-400">repo</code> and{' '}
                  <code className="text-zinc-400">read:user</code> scopes.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savingGithub}
            className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {savingGithub ? 'Saving…' : 'Save'}
          </button>
          {savedGithub && <span className="text-sm text-emerald-400">Saved</span>}
        </div>
      </form>

      {/* Repositories */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Repositories</h2>

        <form
          onSubmit={handleAdd}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 mb-4"
        >
          <p className="text-zinc-400 text-sm mb-3">
            Add repositories to use them as session targets. Removing one will clean up its data if
            no other users have it linked.
          </p>
          <RepoSearchInput
            value={selectedRepo}
            onSelect={setSelectedRepo}
            addedNames={addedNames}
            trailing={
              <button
                type="submit"
                disabled={adding || !selectedRepo}
                className="inline-flex items-center justify-center bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0"
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
            }
          />
        </form>

        {addResult && !addResult.hasBaguetteConfig && (
          <div className="bg-amber-900/20 border border-amber-700 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm text-amber-200">
              <strong>{addResult.repo.full_name}</strong> doesn&apos;t have a baguette configuration
              yet. Start a session on this repo — the agent will offer to configure it
              automatically.
            </p>
            <button
              onClick={() => setAddResult(null)}
              className="mt-2 text-sm text-zinc-400 hover:text-zinc-300"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {repos.length === 0 && (
            <p className="text-zinc-600 text-sm text-center py-8">No repositories added</p>
          )}
          {repos.map((r) => {
            const maskedKey =
              repoKeyOverrides[r.id] !== undefined ? repoKeyOverrides[r.id] : r.anthropic_api_key;
            const isEditing = repoKeyEditingId === r.id;
            return (
              <div key={r.id} className="border-b border-zinc-800 last:border-0">
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="min-w-0">
                    <code className="text-sm text-white font-medium">{r.full_name}</code>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {r.session_count} session(s) · {r.exists_on_fs ? 'On disk' : 'Not on disk'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        if (isEditing) {
                          setRepoKeyEditingId(null);
                          setRepoKeyValue(null);
                          setRepoKeyDirty(false);
                        } else {
                          setRepoKeyEditingId(r.id);
                          setRepoKeyValue(null);
                          setRepoKeyDirty(false);
                        }
                      }}
                      className={`text-xs ${maskedKey ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-zinc-300'}`}
                    >
                      {maskedKey ? 'API key ✓' : 'API key'}
                    </button>
                    <button
                      onClick={() => handleUnlinkClick(r)}
                      disabled={unlinkingId !== null}
                      className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div className="px-4 pb-3 space-y-2">
                    <p className="text-xs text-zinc-400">
                      Anthropic API key for this repo (overrides your account key)
                    </p>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <MaskedSecretInput
                          maskedValue={maskedKey}
                          placeholder="sk-ant-…"
                          onChange={(val, dirty) => {
                            setRepoKeyValue(val);
                            setRepoKeyDirty(dirty);
                          }}
                        />
                      </div>
                      <button
                        onClick={() => handleRepoKeySave(r.id, r.user_repo_id)}
                        disabled={repoKeySaving || !repoKeyDirty}
                        className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0"
                      >
                        {repoKeySaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setRepoKeyEditingId(null);
                          setRepoKeyValue(null);
                          setRepoKeyDirty(false);
                        }}
                        className="text-xs text-zinc-400 hover:text-zinc-300 shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                    {maskedKey && (
                      <button
                        onClick={() => {
                          setRepoKeyValue('');
                          setRepoKeyDirty(true);
                        }}
                        className="text-xs text-zinc-500 hover:text-zinc-400"
                      >
                        Clear key (use account default)
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {confirmUnlink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl max-w-md w-full p-5">
            <h3 className="text-lg font-semibold text-white mb-2">Remove repository?</h3>
            <p className="text-zinc-400 text-sm mb-4">
              <strong className="text-white">{confirmUnlink.full_name}</strong> will be removed from
              your account.
            </p>
            <div className="bg-amber-900/30 border border-amber-700 rounded-lg px-3 py-2 text-sm text-amber-200 mb-4">
              If you are the last user with this repository, all its sessions, worktrees, and the
              bare clone will also be deleted.
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleUnlinkCancel}
                className="px-4 py-2 text-sm text-zinc-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlinkConfirm}
                disabled={unlinkingId !== null}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {unlinkingId !== null ? 'Removing…' : 'Remove repository'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MaskedSecretInput ────────────────────────────────────────────────────────

function MaskedSecretInput({ maskedValue, placeholder, onChange }) {
  const [value, setValue] = useState(maskedValue || '');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setValue(maskedValue || '');
    setIsDirty(false);
  }, [maskedValue]);

  const handleFocus = () => {
    if (!isDirty) setValue('');
  };

  const handleChange = (e) => setValue(e.target.value);

  const handleBlur = () => {
    setIsDirty(true);
    onChange(value, true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setValue(maskedValue || '');
      setIsDirty(false);
      onChange(null, false);
      e.target.blur();
    }
  };

  return (
    <input
      type="password"
      value={value}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={maskedValue ? '(change to update)' : placeholder}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
      autoComplete="off"
    />
  );
}

// ─── NotificationsSection ─────────────────────────────────────────────────────

function NotificationsSection() {
  const [permission, setPermission] = useState(() => {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });
  const [requesting, setRequesting] = useState(false);

  const handleEnable = async () => {
    setRequesting(true);
    const result = await requestNotificationPermission();
    setPermission(result);
    setRequesting(false);
  };

  const statusLabel =
    {
      granted: 'Enabled',
      denied: 'Blocked',
      default: 'Not enabled',
      unsupported: 'Not supported by this browser',
    }[permission] ?? permission;

  const statusColor =
    {
      granted: 'text-emerald-400',
      denied: 'text-red-400',
      default: 'text-zinc-400',
      unsupported: 'text-zinc-500',
    }[permission] ?? 'text-zinc-400';

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">Notifications</h2>
      <p className="text-zinc-400 text-sm mb-4">
        Enable browser notifications to receive alerts when sessions complete or approvals are
        requested, even when the tab is hidden.
      </p>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-300 mb-0.5">Browser notifications</p>
            <p className={`text-xs ${statusColor}`}>{statusLabel}</p>
          </div>
          {permission === 'denied' ? (
            <p className="text-xs text-zinc-500 text-right max-w-[160px]">
              Unblock in browser settings to enable.
            </p>
          ) : permission !== 'granted' && permission !== 'unsupported' ? (
            <button
              onClick={handleEnable}
              disabled={requesting}
              className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              {requesting ? 'Requesting…' : 'Enable Notifications'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── ToggleRow (notifications / approvals) ───────────────────────────────────

function ToggleRow({ label, description, value, onChange, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0 border-b border-zinc-800 last:border-0">
      <div>
        <p className="text-sm font-medium text-zinc-300 mb-0.5">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-50 ${
          value ? 'bg-amber-500' : 'bg-zinc-700'
        }`}
        role="switch"
        aria-checked={value}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

// ─── NotificationsTab ─────────────────────────────────────────────────────────

function NotificationsTab({ settings, onSave }) {
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState(false);

  const handleToggle = async (field) => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await usersService.patch(user.id, { [field]: !settings[field] });
      onSave(updated);
      setUser((prev) => ({ ...prev, [field]: updated[field] }));
    } catch (err) {
      toastError('Failed to update notification settings', err);
    } finally {
      setSaving(false);
    }
  };

  const isDisabled = saving;
  const builderModal = !!settings?.builder_modal_mode;
  const reviewerModal = !!settings?.reviewer_modal_mode;

  return (
    <div className="space-y-10">
      <NotificationsSection />
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Approvals</h2>
        <p className="text-zinc-400 text-sm mb-4">
          Choose whether approval requests use a modal dialog or appear inline in the session chat.
        </p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
          <ToggleRow
            label="Builder sessions — Modal approval"
            description="When enabled, approval requests in builder sessions interrupt your work with a modal dialog. When disabled, they appear inline in the session chat."
            value={builderModal}
            onChange={() => handleToggle('builder_modal_mode')}
            disabled={isDisabled}
          />
          <ToggleRow
            label="Reviewer sessions — Modal approval"
            description="When enabled, approval requests from reviewer agents interrupt your work with a modal dialog. When disabled, they appear inline in the session chat."
            value={reviewerModal}
            onChange={() => handleToggle('reviewer_modal_mode')}
            disabled={isDisabled}
          />
        </div>
      </div>
    </div>
  );
}

// ─── AgentTab ─────────────────────────────────────────────────────────────────

const PERMISSION_MODES = [
  { value: 'default', label: 'Default (ask for approval)' },
  { value: 'acceptEdits', label: 'Accept Edits (auto-approve file changes)' },
  { value: 'bypassPermissions', label: 'Bypass All Permissions' },
];

function AgentTab({ settings, onSave }) {
  const { user } = useAuth();
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [anthropicApiKey, setAnthropicApiKey] = useState(null);
  const [anthropicApiKeyDirty, setAnthropicApiKeyDirty] = useState(false);
  const [branchPrefix, setBranchPrefix] = useState('baguette/');
  const [allowedCommands, setAllowedCommands] = useState([]);
  const [newCommand, setNewCommand] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/api/settings/models')
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (!settings) return;
    setModel(settings.model || '');
    const mode = settings.default_permission_mode || 'default';
    setPermissionMode(mode === 'plan' ? 'default' : mode);
    setBranchPrefix(settings.branch_prefix ?? 'baguette/');
    setAllowedCommands(settings.allowed_commands || []);
    setAnthropicApiKey(null);
    setAnthropicApiKeyDirty(false);
  }, [settings]);

  const systemAllowedCommands = settings?.system_allowed_commands || [];

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const patch = {
        model,
        default_permission_mode: permissionMode,
        branch_prefix: branchPrefix,
        allowed_commands: allowedCommands,
      };
      if (anthropicApiKeyDirty) patch.anthropic_api_key = anthropicApiKey ?? '';
      const updated = await usersService.patch(user.id, patch);
      onSave(updated);
      setAnthropicApiKey(null);
      setAnthropicApiKeyDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {models.length === 0 && <option value={model || ''}>{model || 'Loading…'}</option>}
            {model && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">
            Default permission mode
          </label>
          <select
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Branch prefix</label>
          <input
            type="text"
            value={branchPrefix}
            onChange={(e) => setBranchPrefix(e.target.value)}
            placeholder="baguette/"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Prefix added to all generated branch names. Leave empty for no prefix.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Allowed commands</label>
          <p className="text-xs text-zinc-500 mb-2">
            Command prefixes that Claude can run without asking for approval. Each entry matches any
            command starting with that prefix.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            {systemAllowedCommands.map((cmd) => (
              <span
                key={cmd}
                className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1 text-sm font-mono text-zinc-400"
                title="System command — always allowed"
              >
                {cmd}
                <span className="text-zinc-600 text-xs leading-none">system</span>
              </span>
            ))}
            {allowedCommands.map((cmd) => (
              <span
                key={cmd}
                className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1 text-sm font-mono text-zinc-200"
              >
                {cmd}
                <button
                  type="button"
                  onClick={() => setAllowedCommands(allowedCommands.filter((c) => c !== cmd))}
                  className="text-zinc-500 hover:text-red-400 leading-none"
                  aria-label={`Remove ${cmd}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const cmd = newCommand.trim();
                  if (
                    cmd &&
                    !allowedCommands.includes(cmd) &&
                    !systemAllowedCommands.includes(cmd)
                  ) {
                    setAllowedCommands([...allowedCommands, cmd]);
                  }
                  setNewCommand('');
                }
              }}
              placeholder="e.g. npm, yarn"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
            <button
              type="button"
              onClick={() => {
                const cmd = newCommand.trim();
                if (cmd && !allowedCommands.includes(cmd) && !systemAllowedCommands.includes(cmd)) {
                  setAllowedCommands([...allowedCommands, cmd]);
                }
                setNewCommand('');
              }}
              className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Anthropic API key</label>
          <MaskedSecretInput
            maskedValue={settings?.anthropic_api_key}
            placeholder="sk-ant-…"
            onChange={(val, dirty) => {
              setAnthropicApiKey(val);
              setAnthropicApiKeyDirty(dirty);
            }}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Leave empty to use Claude Code&apos;s default configuration.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'agent', label: 'Agent' },
  { id: 'repos', label: 'Repositories' },
  { id: 'notifications', label: 'Notifications' },
];

export default function Settings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'agent';
  const activeTab = TABS.some((t) => t.id === rawTab) ? rawTab : 'agent';
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);

  const setTab = (tab) => setSearchParams({ tab });

  useEffect(() => {
    if (!user?.id) return;
    usersService
      .get(user.id)
      .then((d) => setSettings(d))
      .catch((err) => setError(err.message));
  }, [user?.id]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-6">Settings</h1>

      <div className="flex border-b border-zinc-800 mb-6 gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${
              activeTab === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300 mb-6">
          {error}
        </div>
      )}

      {!settings && !error ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        settings && (
          <>
            {activeTab === 'agent' && <AgentTab settings={settings} onSave={setSettings} />}
            {activeTab === 'repos' && <RepositoriesTab settings={settings} onSave={setSettings} />}
            {activeTab === 'notifications' && (
              <NotificationsTab settings={settings} onSave={setSettings} />
            )}
          </>
        )
      )}
    </div>
  );
}
