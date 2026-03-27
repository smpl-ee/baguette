import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { REPOS_DIR, resolveDataDirRelativePath } from '../config.js';
import * as cache from '../lib/cache.js';

const execFileAsync = promisify(execFile);

export function gitAuthArgs(token) {
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${encoded}`];
}

function sanitizeGitError(token, err) {
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  const sanitize = (s) =>
    typeof s === 'string' ? s.replaceAll(encoded, '[REDACTED]').replaceAll(token, '[REDACTED]') : s;
  err.message = sanitize(err.message);
  if (err.stderr) err.stderr = sanitize(err.stderr.toString());
  if (err.stdout) err.stdout = sanitize(err.stdout.toString());
  return err;
}

async function gitWithToken(token, args, opts) {
  try {
    return await execFileAsync('git', [...gitAuthArgs(token), ...args], opts);
  } catch (err) {
    throw sanitizeGitError(token, err);
  }
}

let _lfsAvailable = null;
async function lfsAvailable() {
  if (_lfsAvailable === null) {
    try {
      await execFileAsync('git', ['lfs', 'version'], { stdio: 'pipe' });
      _lfsAvailable = true;
    } catch {
      _lfsAvailable = false;
    }
  }
  return _lfsAvailable;
}

function repoUrl(repoFullName) {
  return `https://github.com/${repoFullName}.git`;
}

/** Alphanumeric and dashes only, for directory names. Stored on repo record. */
export function toStrippedName(fullName) {
  return (
    fullName
      .replace(/\//g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'repo'
  );
}

/** Base directory for all repo data (worktrees, bare clone): `<REPOS_DIR>/<stripped>/` */
export function repoDirPath(strippedName) {
  return path.join(REPOS_DIR, strippedName);
}

function barePathForStripped(strippedName) {
  return path.join(repoDirPath(strippedName), 'main');
}

function cacheKeyForToken(token) {
  if (!token) return 'anonymous';
  return crypto.createHash('sha256').update(token).digest('hex');
}

function repoHash(repoFullName) {
  return crypto.createHash('sha256').update(repoFullName).digest('hex');
}

/**
 * Generic paginated GitHub API fetch.
 * @param {string} url    Base URL (without page param)
 * @param {string} token  GitHub token
 * @param {(item: object) => T} mapFn  Transform each response item
 * @returns {Promise<T[]>}
 */
async function fetchAllPages(url, token, mapFn) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };
  const results = [];
  const separator = url.includes('?') ? '&' : '?';
  let page = 1;
  while (true) {
    const res = await fetch(`${url}${separator}per_page=100&page=${page}`, { headers });
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) results.push(mapFn(item));
    if (data.length < 100) break;
    page++;
  }
  return results;
}

const mapRepo = (r) => ({
  full_name: r.full_name,
  description: r.description,
  private: r.private,
  default_branch: r.default_branch,
});

// Refreshing org and repo lists is manual, so we can cache them indefinitely
const REPOS_CACHE_TTL = Infinity;
/** Repos for the "Personal" picker: owned by the user and direct collaborator access (incl. other users' private repos). */
export function listUserRepos(token) {
  return cache.fetch(
    `github-repos-${cacheKeyForToken(token)}-personal-owner-collab`,
    REPOS_CACHE_TTL,
    () =>
      fetchAllPages(
        'https://api.github.com/user/repos?sort=updated&affiliation=owner,collaborator',
        token,
        mapRepo
      )
  );
}

export function listUserOrgs(token) {
  return cache.fetch(`github-orgs-${cacheKeyForToken(token)}`, REPOS_CACHE_TTL, () =>
    fetchAllPages('https://api.github.com/user/orgs', token, (o) => ({
      login: o.login,
      avatar_url: o.avatar_url,
    }))
  );
}

export function listOrgRepos(token, orgLogin) {
  return cache.fetch(
    `github-repos-${cacheKeyForToken(token)}-org-${orgLogin}`,
    REPOS_CACHE_TTL,
    () =>
      fetchAllPages(
        `https://api.github.com/orgs/${orgLogin}/repos?sort=updated&type=all`,
        token,
        mapRepo
      )
  );
}

const BRANCHES_CACHE_TTL = 60;
export function listBranches(token, repoFullName) {
  return cache.fetch(
    `github-branches-${cacheKeyForToken(token)}-${repoHash(repoFullName)}`,
    BRANCHES_CACHE_TTL,
    () =>
      fetchAllPages(`https://api.github.com/repos/${repoFullName}/branches`, token, (b) => b.name)
  );
}

export function clearReposCache(token) {
  return cache.clearByPrefix(`github-repos-${cacheKeyForToken(token)}-`);
}

export function clearOrgsCache(token) {
  return cache.clearByPrefix(`github-orgs-${cacheKeyForToken(token)}`);
}

export function clearBranchesCache(token) {
  return cache.clearByPrefix(`github-branches-${cacheKeyForToken(token)}-`);
}

/**
 * Ensures a bare clone of the repo exists on disk. If already cloned, returns
 * the barePath immediately. Otherwise clones from GitHub. Returns the barePath.
 *
 * @param {object} repo - { full_name, stripped_name, bare_path? }
 * @param {string} token
 */
export async function ensureBareClone(repo, token) {
  const barePath = repo.bare_path || barePathForStripped(repo.stripped_name);

  try {
    await fs.promises.access(barePath);
    return barePath;
  } catch {
    /* clone not present yet */
  }

  await fs.promises.mkdir(path.dirname(barePath), { recursive: true });
  try {
    await fs.promises.rm(barePath, { recursive: true, force: true });
  } catch {
    /* path may not exist */
  }
  await gitWithToken(token, ['clone', '--bare', repoUrl(repo.full_name), barePath], {
    stdio: 'pipe',
  });
  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'fetch', '--all'], { cwd: barePath, stdio: 'pipe' });
    } catch { /* repo may not use LFS */ }
  }
  return barePath;
}

/** @param {{ baseBranch?: string, detach?: boolean }} [opts] — `detach` defaults to true (false checks out `branch` in the new worktree). */
export async function createWorktree(repo, branch, worktreeId, token, opts = {}) {
  const { baseBranch, detach = true } = opts;
  const barePath = repo.bare_path;
  const worktreePath = path.join(REPOS_DIR, repo.stripped_name, 'sessions', worktreeId);
  await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

  await gitWithToken(token, ['fetch', 'origin', `${branch}:${branch}`, '--prune'], {
    cwd: barePath,
    stdio: 'pipe',
  });

  // Also fetch the base branch so origin/<baseBranch> is up to date for merge-base diffs
  if (baseBranch && baseBranch !== branch) {
    await gitWithToken(
      token,
      ['fetch', 'origin', `${baseBranch}:refs/remotes/origin/${baseBranch}`],
      { cwd: barePath, stdio: 'pipe' }
    );
  }

  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'fetch', 'origin', branch], { cwd: barePath, stdio: 'pipe' });
    } catch { /* repo may not use LFS */ }
  }

  try {
    await fs.promises.access(worktreePath);
  } catch {
    const addArgs = detach
      ? ['worktree', 'add', '--detach', worktreePath, branch]
      : ['worktree', 'add', worktreePath, branch];
    await execFileAsync('git', addArgs, {
      cwd: barePath,
      stdio: 'pipe',
    });
  }

  if (await lfsAvailable()) {
    try {
      await execFileAsync('git', ['lfs', 'checkout'], { cwd: worktreePath, stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  return { worktreePath };
}

export async function removeWorktree(session, repo) {
  const absoluteWorktreePath = resolveDataDirRelativePath(session?.worktree_path);
  if (!absoluteWorktreePath) return;
  try {
    await fs.promises.access(absoluteWorktreePath);
  } catch {
    return;
  }

  if (repo?.bare_path) {
    try {
      await fs.promises.access(repo.bare_path);
      await execFileAsync('git', ['worktree', 'remove', '--force', absoluteWorktreePath], {
        cwd: repo.bare_path,
        stdio: 'pipe',
      });
      return;
    } catch {
      /* fall through to rm below */
    }
  }
  await fs.promises.rm(absoluteWorktreePath, { recursive: true, force: true });
}

/**
 * Returns the first open PR whose head is `owner:branch` for this repo, or null.
 * @returns {Promise<null | { number: number, html_url: string, title: string, base_ref: string, draft: boolean }>}
 */
export async function getOpenPR(token, repoFullName, branch) {
  if (!token) return null;
  const [owner] = repoFullName.split('/');
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open&per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const pr = data[0];
  return {
    number: pr.number,
    html_url: pr.html_url,
    title: pr.title,
    base_ref: pr.base.ref,
    draft: Boolean(pr.draft),
  };
}

/**
 * Checks whether the worktree has uncommitted changes or commits not yet pushed
 * to any remote. Returns true if a git-sync turn should be injected.
 */
export async function worktreeNeedsSync(worktreePath) {
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe' });
    const { stdout: staged } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
    });
    if (staged.trim()) return true;

    // Commits that exist locally but have no corresponding remote ref
    const { stdout: unpushed } = await execFileAsync(
      'git',
      ['log', '--oneline', 'HEAD', '--not', '--remotes'],
      { cwd: worktreePath }
    );
    return unpushed.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Checks whether the remote branch has commits that are not yet in the local branch.
 * Returns true if a pull-sync turn should be injected.
 */
export async function remoteHasNewCommits(worktreePath, remoteBranch, token, _repoFullName) {
  try {
    await gitWithToken(token, ['fetch', 'origin', remoteBranch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    const { stdout: behind } = await execFileAsync(
      'git',
      ['rev-list', '--count', `HEAD..origin/${remoteBranch}`],
      { cwd: worktreePath }
    );
    return parseInt(behind.trim(), 10) > 0;
  } catch {
    return false;
  }
}

// ─── Session-level git & PR helpers (used by session-socket) ──────────────────

export async function gitPull(worktreePath, remoteBranch, token) {
  try {
    await gitWithToken(token, ['ls-remote', '--exit-code', 'origin', remoteBranch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } catch {
    return { ok: true, message: 'Remote branch not found, skipping pull' };
  }

  await gitWithToken(token, ['pull', 'origin', remoteBranch], {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  if (await lfsAvailable()) {
    try {
      await gitWithToken(token, ['lfs', 'pull'], { cwd: worktreePath, stdio: 'pipe' });
    } catch { /* repo may not use LFS */ }
  }
  return { ok: true };
}

export async function gitFetch(worktreePath, token, branch) {
  const args = branch
    ? ['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`]
    : ['fetch', '--all'];
  const { stdout: output } = await gitWithToken(token, args, {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  return { ok: true, output: output || '' };
}

/**
 * Push the current HEAD to origin and return the branch name.
 * Throws with a `rejected` property if the push is rejected.
 */
export async function gitPush(worktreePath, token) {
  const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
  });
  const branch = branchOut.trim();

  try {
    await gitWithToken(token, ['push', '--set-upstream', 'origin', branch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
  } catch (pushErr) {
    const stderr = pushErr.stderr?.toString() ?? '';
    if (stderr.includes('[rejected]') || stderr.includes('Updates were rejected')) {
      const err = new Error(
        'Push rejected: the remote has changes not present locally. ' +
          'Call GitPull to pull the latest changes, resolve any conflicts, then call GitPush again.'
      );
      err.rejected = true;
      throw err;
    }
    throw pushErr;
  }

  return { ok: true, branch };
}

// 5 MB: unified diff is plain text, so 5 MB comfortably covers even very large
// sessions (thousands of changed lines across dozens of files). Beyond this the
// output is impractical to display in the browser anyway, and Node's default of
// 1 MB is too small for real-world diffs.
const MAX_DIFF_BUFFER_SIZE = 5 * 1024 * 1024;

/**
 * Returns the unified diff between baseBranch and HEAD in the worktree.
 * @returns {Promise<string>}
 */
export async function gitDiff(
  worktreePath,
  baseBranch,
  { maxBuffer = MAX_DIFF_BUFFER_SIZE, filePath } = {}
) {
  try {
    const ref = `origin/${baseBranch}`;
    const { stdout: mergeBase } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'merge-base', 'HEAD', ref],
      { maxBuffer: 256 }
    );
    const args = ['-C', worktreePath, 'diff', mergeBase.trim()];
    if (filePath) args.push('--', filePath);
    const { stdout } = await execFileAsync('git', args, { maxBuffer });
    return stdout;
  } catch (err) {
    // Non-zero exit still produces stdout in some cases (e.g. binary files)
    if (err.stdout) return err.stdout;
    throw err;
  }
}

/**
 * Fetches the current status of a pull request.
 * @returns {'open' | 'draft' | 'closed' | 'merged'}
 */
export async function getPRStatus(token, repoFullName, prNumber) {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'baguette-app',
    },
  });
  if (!res.ok) throw new Error('Failed to fetch PR status');
  const data = await res.json();
  if (data.merged) return 'merged';
  if (data.state === 'closed') return 'closed';
  if (data.draft) return 'draft';
  return 'open';
}

/**
 * Squash-merges a pull request via the GitHub API.
 */
export async function mergePR(token, repoFullName, prNumber) {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'baguette-app',
    },
    body: JSON.stringify({ merge_method: 'squash' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'Failed to merge PR');
  }
}

/**
 * Fetches a single PR by number. Throws if not found or request fails.
 * @returns {{ number, html_url, title, body, head: { ref }, base: { ref } }}
 */
export async function getOpenPRByNumber(token, repoFullName, prNumber) {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'baguette-app',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch PR #${prNumber}: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    number: data.number,
    html_url: data.html_url,
    title: data.title,
    body: data.body || '',
    head: { ref: data.head.ref },
    base: { ref: data.base.ref },
  };
}

/**
 * Lists issue comments and inline review comments for a PR.
 * @returns {{ issueComments: object[], reviewComments: object[] }}
 */
export async function getPRComments(token, repoFullName, prNumber) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'baguette-app',
  };
  const mapComment = (c) => ({
    id: c.id,
    user: c.user?.login,
    body: c.body,
    created_at: c.created_at,
    html_url: c.html_url,
  });
  const mapReviewComment = (c) => ({
    id: c.id,
    user: c.user?.login,
    body: c.body,
    path: c.path,
    line: c.line ?? c.original_line,
    created_at: c.created_at,
    html_url: c.html_url,
  });

  const [issueRes, reviewRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments?per_page=100`, {
      headers,
    }),
    fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/comments?per_page=100`, {
      headers,
    }),
  ]);

  const issueComments = issueRes.ok
    ? (await issueRes.json()).filter((c) => !(c.reactions?.eyes > 0)).map(mapComment)
    : [];
  const reviewComments = reviewRes.ok
    ? (await reviewRes.json()).filter((c) => !(c.reactions?.eyes > 0)).map(mapReviewComment)
    : [];
  return { issueComments, reviewComments };
}

/**
 * Adds a reaction to a PR comment (issue comment or review comment).
 * @param {'issue'|'review'} commentType
 * @param {string} content - GitHub reaction type, e.g. 'eyes'
 */
export async function addReactionToComment(
  token,
  repoFullName,
  commentId,
  commentType,
  content = 'eyes'
) {
  const endpoint =
    commentType === 'review'
      ? `https://api.github.com/repos/${repoFullName}/pulls/comments/${commentId}/reactions`
      : `https://api.github.com/repos/${repoFullName}/issues/comments/${commentId}/reactions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'User-Agent': 'baguette-app',
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to add reaction: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Posts an issue comment on a PR.
 * @returns {{ id, url, body }}
 */
export async function createPRComment(token, repoFullName, prNumber, body) {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to post PR comment: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { id: data.id, url: data.html_url, body: data.body };
}

/**
 * Posts an inline review comment on a specific line of a PR.
 * @returns {{ id, url, body }}
 */
export async function createPRLineComment(
  token,
  repoFullName,
  prNumber,
  { body, path, line, commitId, side = 'RIGHT' }
) {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
      body: JSON.stringify({ body, path, line, commit_id: commitId, side }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to post inline PR comment: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { id: data.id, url: data.html_url, body: data.body, path: data.path, line: data.line };
}

/**
 * Submits a PR review.
 * @param {string} event - 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
 * @param {Array<{body, path, line, side?}>} [comments] - Optional inline comments to include in the review
 * @param {string} [commitId] - Required when comments are provided
 * @returns {{ id, state, body }}
 */
export async function createPRReview(
  token,
  repoFullName,
  prNumber,
  event,
  body,
  comments = [],
  commitId = null
) {
  const payload = { body, event };
  if (comments.length > 0) {
    payload.comments = comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: c.body,
      side: c.side || 'RIGHT',
    }));
    if (commitId) payload.commit_id = commitId;
  }
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/reviews`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'baguette-app',
      },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to submit PR review: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { id: data.id, state: data.state, body: data.body };
}

/**
 * Lists recent workflow runs for a branch.
 * @returns {Array<{ id, name, status, conclusion, html_url, created_at }>}
 */
export async function getPRWorkflows(token, repoFullName, branch) {
  const url = `https://api.github.com/repos/${repoFullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=10`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'baguette-app',
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    created_at: r.created_at,
  }));
}

const DEFAULT_LOG_BYTES = 8000;

/**
 * Fetches logs for failed jobs (or all jobs if none failed) in a workflow run.
 * Supports byte-range pagination: pass startByte/endByte to read specific chunks.
 * By default returns the last DEFAULT_LOG_BYTES bytes (where errors appear).
 *
 * @returns {{ jobs: Array<{ id, name, status, conclusion, log, totalBytes, startByte, endByte }> }}
 */
export async function getPRWorkflowLogs(token, repoFullName, runId, { startByte, endByte } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'baguette-app',
  };

  // Get jobs list for this run
  const jobsRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/actions/runs/${runId}/jobs?per_page=30`,
    { headers }
  );
  if (!jobsRes.ok) {
    throw new Error(`Failed to fetch jobs for run ${runId}: ${jobsRes.status}`);
  }
  const jobsData = await jobsRes.json();
  const allJobs = jobsData.jobs || [];

  // Focus on failed jobs; fall back to all jobs if none failed
  const failedJobs = allJobs.filter(
    (j) => j.conclusion === 'failure' || j.conclusion === 'timed_out'
  );
  const targetJobs = failedJobs.length > 0 ? failedJobs : allJobs;

  const results = await Promise.all(
    targetJobs.map(async (job) => {
      // Step 1: get the redirect URL for this job's logs (GitHub returns 302)
      const logRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/actions/jobs/${job.id}/logs`,
        { headers, redirect: 'manual' }
      );
      const logUrl = logRes.headers.get('location');
      if (!logUrl) {
        return {
          id: job.id,
          name: job.name,
          status: job.status,
          conclusion: job.conclusion,
          log: '(log unavailable)',
          totalBytes: 0,
          startByte: 0,
          endByte: 0,
        };
      }

      // Step 2: build Range header
      let rangeHeader;
      if (startByte != null && endByte != null) {
        rangeHeader = `bytes=${startByte}-${endByte}`;
      } else if (startByte != null) {
        rangeHeader = `bytes=${startByte}-`;
      } else {
        rangeHeader = `bytes=-${DEFAULT_LOG_BYTES}`;
      }

      // Step 3: fetch log with range
      const rangeRes = await fetch(logUrl, { headers: { Range: rangeHeader } });
      const log = await rangeRes.text();

      // Parse Content-Range: bytes start-end/total
      let totalBytes = 0;
      let actualStart = startByte ?? 0;
      let actualEnd = endByte ?? DEFAULT_LOG_BYTES;
      const contentRange = rangeRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
        if (match) {
          actualStart = parseInt(match[1], 10);
          actualEnd = parseInt(match[2], 10);
          totalBytes = parseInt(match[3], 10);
        }
      }

      return {
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        log,
        totalBytes,
        startByte: actualStart,
        endByte: actualEnd,
      };
    })
  );

  return { jobs: results };
}

/**
 * Create or update a pull request via the GitHub API.
 * @returns {{ url: string, number: number }}
 */
export async function upsertPR(token, { repoFullName, prNumber, title, body, head, baseBranch }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'baguette-app',
  };

  if (prNumber) {
    const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub PATCH failed: ${text}`);
    }
    const data = await res.json();
    return { url: data.html_url, number: data.number };
  }

  const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, body, head, base: baseBranch }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub POST failed: ${text}`);
  }
  const data = await res.json();
  return { url: data.html_url, number: data.number };
}
