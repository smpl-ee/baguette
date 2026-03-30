import { describe, it, expect, vi, beforeEach } from 'vitest';

// Override global setup.js mock for claude-agent-sdk so tool() and createSdkMcpServer work
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const tool = (name, description, inputSchema, handler) => ({
    name,
    description,
    inputSchema,
    handler,
  });
  const createSdkMcpServer = vi.fn((opts) => ({ name: opts.name, tools: opts.tools }));
  return { tool, createSdkMcpServer };
});

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, { stdout: '', stderr: '' })),
}));

vi.mock('../github.js', () => ({
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitFetch: vi.fn(),
  upsertPR: vi.fn(),
  getOpenPR: vi.fn().mockResolvedValue(null),
  getPRComments: vi.fn(),
  createPRComment: vi.fn(),
  createPRLineComment: vi.fn(),
  createPRReview: vi.fn(),
  getPRWorkflows: vi.fn(),
  getPRWorkflowLogs: vi.fn(),
}));

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadBaguetteConfig: vi.fn().mockResolvedValue(null) };
});

vi.mock('../agent-settings.js', () => ({ getEffectiveGithubToken: vi.fn(() => 'ghtoken') }));
vi.mock('../logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DOCKER_COMPOSE_PATH: '/docker-compose.yml',
  };
});
vi.mock('../prompts/loadPrompt.js', () => ({ default: vi.fn().mockResolvedValue('prompt text') }));

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'child_process';
import {
  gitPull,
  gitPush,
  gitFetch,
  upsertPR,
  getOpenPR,
  getPRComments,
  createPRComment,
  createPRLineComment,
  createPRReview,
  getPRWorkflows,
  getPRWorkflowLogs,
} from '../github.js';
import { loadBaguetteConfig } from '../baguette-config.js';
import { buildBaguetteMcpServer } from '../baguette-mcp-server.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

const DEFAULT_SESSION = {
  id: 1,
  pr_url: null,
  pr_number: null,
  remote_branch: null,
  created_branch: null,
  repo_full_name: 'owner/repo',
  base_branch: 'main',
  worktree_path: '/tmp/wt',
};

/** Simulates a task that calls onLog/onExit callbacks asynchronously. */
function makeTaskCreate({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  return vi.fn().mockImplementation((data) => {
    const task = { id: 99 };
    setImmediate(() => {
      if (stdout) data.onLog?.(task.id, 'stdout', stdout);
      if (stderr) data.onLog?.(task.id, 'stderr', stderr);
      setImmediate(() => data.onExit?.(task.id, exitCode));
    });
    return Promise.resolve(task);
  });
}

function makeApp(sessionData, { tasksCreate } = {}) {
  const mockPatch = vi.fn().mockResolvedValue({});
  const mockGetTaskEnv = vi.fn().mockResolvedValue({});
  const mockCreate = tasksCreate ?? vi.fn().mockResolvedValue({ id: 99 });
  const db = (table) => {
    if (table === 'sessions') return { where: () => ({ first: async () => sessionData }) };
    if (table === 'users')
      return { where: () => ({ first: async () => ({ id: 1, github_token: 'tok' }) }) };
    if (table === 'repos')
      return { where: () => ({ first: async () => ({ id: 1, default_branch: 'main' }) }) };
    return { where: () => ({ first: async () => null }) };
  };
  const app = {
    get: (key) => (key === 'db' ? db : null),
    service: (name) => {
      if (name === 'users') return { get: async () => ({ id: 1, github_token: 'tok' }) };
      return { patch: mockPatch, getTaskEnv: mockGetTaskEnv, create: mockCreate };
    },
  };
  return { app, mockPatch, mockGetTaskEnv, mockCreate };
}

function buildServer(sessionOverrides = {}, appOpts = {}) {
  const sessionRow = { ...DEFAULT_SESSION, ...sessionOverrides };
  const { app, mockPatch, mockGetTaskEnv, mockCreate } = makeApp(sessionRow, appOpts);
  buildBaguetteMcpServer(1, 1, sessionRow, app);
  const tools = createSdkMcpServer.mock.calls[0][0].tools;
  return { tools, mockPatch, mockGetTaskEnv, mockCreate };
}

function callTool(tools, name, args = {}) {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool '${name}' not found`);
  return t.handler(args, null);
}

function parseResult(res) {
  return JSON.parse(res.content[0].text);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PrRead', () => {
  it('returns pr_url: null and a message when no PR exists', async () => {
    const { tools } = buildServer({ pr_url: null, pr_number: null, remote_branch: 'feat' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.ok).toBe(true);
    expect(result.pr_url).toBeNull();
    expect(result.pr_number).toBeNull();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('returns pr_url and no message when PR exists', async () => {
    const { tools } = buildServer({
      pr_url: 'https://github.com/owner/repo/pull/42',
      pr_number: 42,
    });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.ok).toBe(true);
    expect(result.pr_url).toBe('https://github.com/owner/repo/pull/42');
    expect(result.message).toBeUndefined();
  });

  it('returns branch from remote_branch', async () => {
    const { tools } = buildServer({ remote_branch: 'feat/my-branch' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.branch).toBe('feat/my-branch');
  });

  it('falls back to created_branch when remote_branch is null', async () => {
    const { tools } = buildServer({ remote_branch: null, created_branch: 'created-branch' });
    const result = parseResult(await callTool(tools, 'PrRead'));
    expect(result.branch).toBe('created-branch');
  });
});

describe('GitPull', () => {
  it('returns ok without calling gitPull when remote_branch is null', async () => {
    const { tools } = buildServer({ remote_branch: null });
    const result = parseResult(await callTool(tools, 'GitPull'));
    expect(result.ok).toBe(true);
    expect(gitPull).not.toHaveBeenCalled();
  });

  it('calls gitPull with worktreePath, remoteBranch, token and returns result', async () => {
    gitPull.mockResolvedValue({ message: 'Already up to date.' });
    const { tools } = buildServer({ remote_branch: 'feature-branch' });
    const result = parseResult(await callTool(tools, 'GitPull'));
    expect(result.ok).toBe(true);
    expect(gitPull).toHaveBeenCalledWith('/tmp/wt', 'feature-branch', 'ghtoken');
  });
});

describe('GitFetch', () => {
  it('calls gitFetch and returns result', async () => {
    gitFetch.mockResolvedValue({ ok: true });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'GitFetch', { branch: 'main' }));
    expect(result.ok).toBe(true);
    expect(gitFetch).toHaveBeenCalledWith('/tmp/wt', 'ghtoken', 'main');
  });
});

describe('GitPush', () => {
  it('returns ok: false when push is rejected', async () => {
    const err = Object.assign(new Error('push rejected: run git-pull to resolve conflict'), {
      rejected: true,
    });
    gitPush.mockRejectedValue(err);
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/conflict/i);
  });

  it('patches session with branch name on success', async () => {
    gitPush.mockResolvedValue({ ok: true, branch: 'feature-branch' });
    const { tools, mockPatch } = buildServer();
    const result = parseResult(await callTool(tools, 'GitPush'));
    expect(result.ok).toBe(true);
    expect(result.branch).toBe('feature-branch');
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      { remote_branch: 'feature-branch', created_branch: 'feature-branch' },
      expect.anything()
    );
  });
});

describe('PrUpsert', () => {
  it('resolves HEAD, creates PR, and patches session when no pr_number', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'feature-branch\n', stderr: '' })
    );
    upsertPR.mockResolvedValue({ url: 'https://github.com/owner/repo/pull/1', number: 1 });
    const { tools, mockPatch } = buildServer({ pr_number: null });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'My PR', description: 'Details' })
    );
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://github.com/owner/repo/pull/1');
    expect(upsertPR).toHaveBeenCalledWith(
      'ghtoken',
      expect.objectContaining({ head: 'feature-branch' })
    );
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      {
        pr_url: 'https://github.com/owner/repo/pull/1',
        pr_number: 1,
        pr_status: 'open',
        label: 'My PR',
      },
      expect.anything()
    );
  });

  it('updates existing PR without HEAD lookup; only patches label', async () => {
    upsertPR.mockResolvedValue({ url: 'https://github.com/owner/repo/pull/5', number: 5 });
    const { tools, mockPatch } = buildServer({ pr_number: 5 });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'Updated', description: 'Updated body' })
    );
    expect(result.ok).toBe(true);
    expect(execFile).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith(1, { label: 'Updated' }, expect.anything());
  });

  it('fails and links session when an open PR already exists for HEAD', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'my-feature\n', stderr: '' })
    );
    getOpenPR.mockResolvedValueOnce({
      number: 7,
      html_url: 'https://github.com/owner/repo/pull/7',
      title: 'Already open',
      base_ref: 'main',
      draft: false,
    });
    const { tools, mockPatch } = buildServer({ pr_number: null });
    const result = parseResult(
      await callTool(tools, 'PrUpsert', { title: 'New title', description: 'Body' })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/);
    expect(upsertPR).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith(
      1,
      {
        pr_url: 'https://github.com/owner/repo/pull/7',
        pr_number: 7,
        pr_status: 'open',
        label: 'Already open',
      },
      expect.anything()
    );
  });
});

describe('ListProjectCommands', () => {
  it('returns ok: true with empty commands and a message when config is missing', async () => {
    loadBaguetteConfig.mockResolvedValue(null);
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([]);
    expect(result.message).toMatch(/ConfigRepoPrompt/);
  });

  it('returns ok: false when config has a parse error', async () => {
    loadBaguetteConfig.mockResolvedValue({ error: 'Failed to parse YAML' });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(false);
  });

  it('filters entries missing label or run; returns only valid commands', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: {
        commands: [
          { label: 'Run tests', run: 'npm test' },
          { label: 'Build', run: 'npm run build' },
          { label: 'no-run-field' },
          { run: 'no-label-field' },
          null,
        ],
      },
    });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([
      { label: 'Run tests', run: 'npm test' },
      { label: 'Build', run: 'npm run build' },
    ]);
  });

  it('returns empty commands array when config has no commands', async () => {
    loadBaguetteConfig.mockResolvedValue({ session: {} });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ListProjectCommands'));
    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([]);
  });
});

describe('RunProjectCommand', () => {
  it('returns ok: false when config is missing', async () => {
    loadBaguetteConfig.mockResolvedValue(null);
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(false);
  });

  it('returns ok: false when label is not found', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Build', run: 'npm run build' }] },
    });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Unknown' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown/);
  });

  it('returns ok: false when config has a parse error', async () => {
    loadBaguetteConfig.mockResolvedValue({ error: 'bad YAML' });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(false);
  });

  it('creates task and returns stdout on exit 0', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0, stdout: 'all tests passed\n' }) }
    );
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdoutLines).toEqual(['all tests passed']);
    expect(result.stderrLines).toEqual([]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm test' }),
      expect.anything()
    );
  });

  it('returns stdout and stderr when command exits non-zero', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools } = buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 1, stderr: 'Test failed\n' }) }
    );
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderrLines).toEqual(['Test failed']);
  });

  it('returns full stdout as lines without truncation', async () => {
    const huge = `${'x'.repeat(90_000)}\nLAST_LINE\n`;
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools } = buildServer(
      {},
      { tasksCreate: makeTaskCreate({ exitCode: 0, stdout: huge }) }
    );
    const result = parseResult(await callTool(tools, 'RunProjectCommand', { label: 'Run tests' }));
    expect(result.ok).toBe(true);
    const joined = result.stdoutLines.join('\n');
    expect(joined).toBe(huge.replace(/\n$/, ''));
    expect(joined).toContain('LAST_LINE');
    expect(joined.length).toBeGreaterThan(90_000);
  });

  it('appends a single file path arg', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'vitest run' }] },
    });
    const { tools, mockCreate } = buildServer({}, { tasksCreate: makeTaskCreate({ exitCode: 0 }) });
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests', args: ['src/foo.test.js'] });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'vitest run src/foo.test.js' }),
      expect.anything()
    );
  });

  it('appends multiple args (e.g. --grep flag with pattern)', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'vitest run' }] },
    });
    const { tools, mockCreate } = buildServer({}, { tasksCreate: makeTaskCreate({ exitCode: 0 }) });
    await callTool(tools, 'RunProjectCommand', {
      label: 'Run tests',
      args: ['--reporter', 'verbose', 'src/foo.test.js'],
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'vitest run --reporter verbose src/foo.test.js' }),
      expect.anything()
    );
  });

  it('runs without extra args when args is omitted', async () => {
    loadBaguetteConfig.mockResolvedValue({
      session: { commands: [{ label: 'Run tests', run: 'npm test' }] },
    });
    const { tools, mockCreate } = buildServer({}, { tasksCreate: makeTaskCreate({ exitCode: 0 }) });
    await callTool(tools, 'RunProjectCommand', { label: 'Run tests' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm test' }),
      expect.anything()
    );
  });
});

describe('PrComments', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = buildServer({ pr_number: null });
    const result = parseResult(await callTool(tools, 'PrComments'));
    expect(result.ok).toBe(false);
  });

  it('calls getPRComments and returns result', async () => {
    getPRComments.mockResolvedValue({ comments: [], reviewComments: [] });
    const { tools } = buildServer({ pr_number: 42 });
    const result = parseResult(await callTool(tools, 'PrComments'));
    expect(result.ok).toBe(true);
    expect(getPRComments).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42);
  });
});

describe('PrComment', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = buildServer({ pr_number: null });
    const result = parseResult(await callTool(tools, 'PrComment', { body: 'hello' }));
    expect(result.ok).toBe(false);
  });

  it('posts general comment via createPRComment when no path/line', async () => {
    createPRComment.mockResolvedValue({ id: 1 });
    const { tools } = buildServer({ pr_number: 42 });
    const result = parseResult(await callTool(tools, 'PrComment', { body: 'Looks good!' }));
    expect(result.ok).toBe(true);
    expect(createPRComment).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42, 'Looks good!');
    expect(createPRLineComment).not.toHaveBeenCalled();
  });

  it('posts inline comment via createPRLineComment when path and line are provided', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'abc1234\n', stderr: '' })
    );
    createPRLineComment.mockResolvedValue({ id: 2 });
    const { tools } = buildServer({ pr_number: 42 });
    const result = parseResult(
      await callTool(tools, 'PrComment', { body: 'Issue here', path: 'src/foo.js', line: 10 })
    );
    expect(result.ok).toBe(true);
    expect(createPRLineComment).toHaveBeenCalledWith('ghtoken', 'owner/repo', 42, {
      body: 'Issue here',
      path: 'src/foo.js',
      line: 10,
      commitId: 'abc1234',
      side: undefined,
    });
  });

  it('passes explicit side to createPRLineComment', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'abc1234\n', stderr: '' })
    );
    createPRLineComment.mockResolvedValue({ id: 3 });
    const { tools } = buildServer({ pr_number: 42 });
    await callTool(tools, 'PrComment', {
      body: 'Deleted line',
      path: 'src/foo.js',
      line: 5,
      side: 'LEFT',
    });
    expect(createPRLineComment).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      expect.objectContaining({ side: 'LEFT' })
    );
  });
});

describe('PrReview', () => {
  it('returns ok: false when no PR', async () => {
    const { tools } = buildServer({ pr_number: null });
    const result = parseResult(
      await callTool(tools, 'PrReview', { event: 'approve', body: 'LGTM' })
    );
    expect(result.ok).toBe(false);
  });

  it('maps approve → APPROVE and calls createPRReview', async () => {
    createPRReview.mockResolvedValue({ id: 1 });
    const { tools } = buildServer({ pr_number: 42 });
    const result = parseResult(
      await callTool(tools, 'PrReview', { event: 'approve', body: 'LGTM' })
    );
    expect(result.ok).toBe(true);
    expect(createPRReview).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      'APPROVE',
      'LGTM',
      [],
      null
    );
  });

  it('maps request-changes → REQUEST_CHANGES', async () => {
    createPRReview.mockResolvedValue({ id: 2 });
    const { tools } = buildServer({ pr_number: 42 });
    await callTool(tools, 'PrReview', { event: 'request-changes', body: 'Fix this' });
    expect(createPRReview).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      'REQUEST_CHANGES',
      'Fix this',
      [],
      null
    );
  });

  it('passes inline comments and commitId when comments are provided', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'abc1234\n', stderr: '' })
    );
    createPRReview.mockResolvedValue({ id: 3 });
    const { tools } = buildServer({ pr_number: 42 });
    const comments = [{ body: 'Fix this', path: 'src/foo.js', line: 10 }];
    const result = parseResult(
      await callTool(tools, 'PrReview', { event: 'comment', body: 'Has issues', comments })
    );
    expect(result.ok).toBe(true);
    expect(createPRReview).toHaveBeenCalledWith(
      'ghtoken',
      'owner/repo',
      42,
      'COMMENT',
      'Has issues',
      comments,
      'abc1234'
    );
  });
});

describe('PrWorkflows', () => {
  it('returns empty runs and message when no branch', async () => {
    const { tools } = buildServer({ remote_branch: null, created_branch: null });
    const result = parseResult(await callTool(tools, 'PrWorkflows'));
    expect(result.ok).toBe(true);
    expect(result.runs).toEqual([]);
    expect(typeof result.message).toBe('string');
  });

  it('calls getPRWorkflows with remote_branch', async () => {
    getPRWorkflows.mockResolvedValue([{ id: 1, status: 'completed' }]);
    const { tools } = buildServer({ remote_branch: 'feat/branch' });
    const result = parseResult(await callTool(tools, 'PrWorkflows'));
    expect(result.ok).toBe(true);
    expect(getPRWorkflows).toHaveBeenCalledWith('ghtoken', 'owner/repo', 'feat/branch');
    expect(result.runs).toHaveLength(1);
  });

  it('falls back to created_branch when remote_branch is null', async () => {
    getPRWorkflows.mockResolvedValue([]);
    const { tools } = buildServer({ remote_branch: null, created_branch: 'created-branch' });
    await callTool(tools, 'PrWorkflows');
    expect(getPRWorkflows).toHaveBeenCalledWith('ghtoken', 'owner/repo', 'created-branch');
  });
});

describe('PrWorkflowLogs', () => {
  it('calls getPRWorkflowLogs with runId and byte range', async () => {
    getPRWorkflowLogs.mockResolvedValue({ logs: 'build failed\n', totalBytes: 5000 });
    const { tools } = buildServer();
    const result = parseResult(
      await callTool(tools, 'PrWorkflowLogs', { runId: '12345', startByte: 0, endByte: 8000 })
    );
    expect(result.ok).toBe(true);
    expect(getPRWorkflowLogs).toHaveBeenCalledWith('ghtoken', 'owner/repo', '12345', {
      startByte: 0,
      endByte: 8000,
    });
  });

  it('passes undefined byte range when not specified', async () => {
    getPRWorkflowLogs.mockResolvedValue({ logs: '', totalBytes: 0 });
    const { tools } = buildServer();
    await callTool(tools, 'PrWorkflowLogs', { runId: '99' });
    expect(getPRWorkflowLogs).toHaveBeenCalledWith('ghtoken', 'owner/repo', '99', {
      startByte: undefined,
      endByte: undefined,
    });
  });
});

describe('GitDiff', () => {
  it('calls git merge-base to compute base and returns annotated diff', async () => {
    execFile
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        // merge-base call
        if (args[0] === 'merge-base') cb(null, { stdout: 'abc123\n', stderr: '' });
        else cb(null, { stdout: '', stderr: '' });
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        // diff call
        cb(null, { stdout: '@@ -1,3 +1,3 @@\n context\n+added line\n-removed\n', stderr: '' });
      });
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'GitDiff', { args: [] }));
    expect(result.ok).toBe(true);
    expect(result.base).toBe('abc123');
    expect(result.diff).toContain('L2: +added line');
    expect(result.diff).toContain('(del): -removed');
  });

  it('skips annotation for --name-only flag', async () => {
    execFile
      .mockImplementationOnce((_cmd, args, _opts, cb) =>
        cb(null, { stdout: 'abc123\n', stderr: '' })
      )
      .mockImplementationOnce((_cmd, _args, _opts, cb) =>
        cb(null, { stdout: 'src/foo.js\nsrc/bar.js\n', stderr: '' })
      );
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'GitDiff', { args: ['--name-only'] }));
    expect(result.diff).toBe('src/foo.js\nsrc/bar.js\n');
    expect(result.diff).not.toContain('L1:');
  });

  it('falls back to HEAD~1 when no base branch configured', async () => {
    execFile.mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, { stdout: 'file.js\n', stderr: '' })
    );
    const { tools } = buildServer({ base_branch: null });
    const result = parseResult(await callTool(tools, 'GitDiff', { args: ['--name-only'] }));
    expect(result.base).toBe('HEAD~1');
  });
});

describe('ShowDiff', () => {
  it('returns ok: true with path and no diff content', async () => {
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ShowDiff', { path: 'src/foo.js' }));
    expect(result.ok).toBe(true);
    expect(result.path).toBe('src/foo.js');
    expect(result.diff).toBeUndefined();
  });
});

describe('ConfigRepoPrompt', () => {
  it('calls loadPrompt and returns combined prompt text', async () => {
    const { tools } = buildServer();
    const result = parseResult(await callTool(tools, 'ConfigRepoPrompt'));
    expect(result.ok).toBe(true);
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
  });
});
