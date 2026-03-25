import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import logger from '../../logger.js';
import { remoteHasNewCommits } from '../github.js';
import {
  getAgentModelFromUser,
  getEffectiveGithubToken,
  getAllowedCommandsFromUser,
} from '../agent-settings.js';
import { getModelId } from '../anthropic-models.js';
import { loadBaguetteConfig } from '../baguette-config.js';
import { buildClaudeEnvFromUser } from '../session-env.js';
import { buildBaguetteMcpServer } from '../baguette-mcp-server.js';
import { createMessageChannel } from '../message-channel.js';
import loadPrompt from '../../prompts/loadPrompt.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { SDK_QUERY_CLOSED_MESSAGE } from '../../claude-agent-sdk-constants.js';

function isHumanUserMessage(message) {
  if (message.type !== 'user') return false;
  const content = message.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return !content.some((b) => b.type === 'tool_result');
  return false;
}

function commandsToAllowedTools(commands) {
  return commands.map((cmd) => `Bash(${cmd}*)`);
}

async function buildQueryOptions(
  sessionRow,
  { canUseTool, env, model, abortController, allowedTools, mcpServer }
) {
  const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow.worktree_path) || '';
  const hasBaguetteYaml = Boolean(await loadBaguetteConfig(sessionRow.worktree_path));
  const baguetteConfigNotice = hasBaguetteYaml
    ? ''
    : '**IMPORTANT**: this project has no .baguette.yaml config file. Call the `ConfigRepoPrompt` tool before tackling the requested task, read the returned prompt and proceed accordingly.\n\n';

  return {
    cwd: absoluteWorktreePath,
    permissionMode: sessionRow.plan_mode ? 'plan' : sessionRow.permission_mode,
    resume: sessionRow.claude_session_id,
    canUseTool,
    env,
    model: model || undefined,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: await loadPrompt('build-prompt', {
        base_branch: sessionRow.base_branch,
        worktree_path: absoluteWorktreePath,
        baguette_config_notice: baguetteConfigNotice,
        base_prompt: await loadPrompt('base-prompt', {
          worktree_path: absoluteWorktreePath,
          working_directory_restrictions:
            'Work exclusively within your current working directory. Do not read, edit, search files or run any shell command outside of it.',
        }),
      }),
    },
    tools: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project'],
    abortController,
    mcpServers: { baguette: mcpServer },
    ...(allowedTools?.length ? { allowedTools } : {}),
  };
}

async function buildReviewerQueryOptions(
  sessionRow,
  { canUseTool, env, model, abortController, mcpServer }
) {
  const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow.worktree_path) || '';
  return {
    cwd: absoluteWorktreePath,
    permissionMode: 'default',
    resume: sessionRow.claude_session_id,
    canUseTool,
    env,
    model: model || undefined,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: await loadPrompt('reviewer-prompt', {
        worktree_path: absoluteWorktreePath,
        pr_number: String(sessionRow.pr_number || ''),
        repo_full_name: sessionRow.repo_full_name || '',
        base_prompt: await loadPrompt('base-prompt', {
          worktree_path: absoluteWorktreePath,
          working_directory_restrictions:
            'Work exclusively within your current working directory. Do NOT modify, create, or delete any files.',
        }),
      }),
    },
    tools: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project'],
    abortController,
    mcpServers: { baguette: mcpServer },
  };
}

// ─── ClaudeAgentService class ─────────────────────────────────────────────────

export class ClaudeAgentService {
  constructor() {
    this._activeSessions = new Map();
    this._resumePromises = new Map();
  }

  setup(app, _path) {
    this.app = app;
  }

  async onMessageCreated(message) {
    if (message.type !== 'user') return;

    const sessionId = message.session_id;

    // Check in-memory first — handles active sessions before claude_session_id is persisted
    const active = this.getActiveSession(sessionId);
    if (active) {
      const parsed =
        typeof message.message_json === 'string'
          ? JSON.parse(message.message_json)
          : message.message_json;
      active.channel.push(parsed);
      return;
    }

    const db = this.app.get('db');
    const session = await db('sessions').where({ id: sessionId }).first();
    if (!session || session.archived_at) return;

    let agentSession;
    if (session.claude_session_id) {
      agentSession = await this.ensureActiveSession(sessionId);
    } else {
      agentSession = await this.createAgentSession(session);
    }

    const parsed =
      typeof message.message_json === 'string'
        ? JSON.parse(message.message_json)
        : message.message_json;
    agentSession.channel.push(parsed);
  }

  async createAgentSession(session) {
    const db = this.app.get('db');
    const { id: sessionId, user_id: userId } = session;

    const sessionRow = await db('sessions').where({ id: sessionId }).first();
    const sessionUser = await db('users').where({ id: userId }).first();
    const sessionState = await this._startAgentLoop({ sessionId, sessionRow, user: sessionUser });

    await this.app
      .service('sessions')
      .patch(sessionId, { status: 'running' }, { user: { id: userId } });
    return sessionState;
  }

  getActiveSession(sessionId) {
    return this._activeSessions.get(sessionId);
  }

  /**
   * Tear down SDK handles and drop the session from `_activeSessions`.
   * Idempotent: no-op if already removed (e.g. after `stopSession`, end of a turn’s `result`, or a prior dispose).
   *
   * **Why we drop the session from memory after each completed turn:** the SDK query holds transports,
   * MCP state, and subprocess-related work. Removing it from `_activeSessions` once a `result` arrives
   * avoids unbounded growth when many sessions stay idle; the next user message calls `ensureActiveSession`
   * and resumes via `claude_session_id` on a fresh query.
   *
   * **Why `close()` is deferred:** see {@link ClaudeAgentService._closeQueryInstanceSafe} — short settlement
   * before `close()`. Expected SDK rejects from {@link SDK_QUERY_CLOSED_MESSAGE} are ignored globally in
   * `server/index.js`.
   *
   * **Order:** stop feeding the channel and abort first so the CLI winds down; clear approval waiters and
   * remove from `_activeSessions` so a new query can start for this session while we wait to `close()` the
   * old instance on the next tick.
   */
  /**
   * Close the SDK query. Brief pre-close delays let MCP/control work drain after abort. In-flight
   * promises may still reject with {@link SDK_QUERY_CLOSED_MESSAGE}; those are treated as benign in
   * `process.on('unhandledRejection')` in `server/index.js`.
   */
  async _closeQueryInstanceSafe(sessionId, queryInstance) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      queryInstance.close();
    } catch (err) {
      logger.warn({ sessionId, err: err.message }, 'claude-agent session dispose cleanup');
    }
  }

  async _disposeActiveSession(sessionId) {
    const session = this._activeSessions.get(sessionId);
    if (!session) return;
    try {
      // No further user turns on this query; abort signals the SDK side to stop.
      session.channel.end();
      session.abortController.abort();
    } catch (err) {
      logger.warn({ sessionId, err: err.message }, 'claude-agent session dispose cleanup');
    }
    session.permissionRequests.clear();
    this._activeSessions.delete(sessionId);
    await this._closeQueryInstanceSafe(sessionId, session.queryInstance);
  }

  async _persistSessionStatusMessage(sessionId, userId, statusText) {
    const payload = {
      type: 'system',
      subtype: 'status',
      status: statusText,
    };
    await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify(payload),
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  /**
   * canUseTool for reviewer sessions: auto-allows read tools and reviewer MCP tools,
   * proxies AskUserQuestion through the standard approval flow, denies everything else silently.
   */
  createReviewerCanUseTool(sessionId, userId, permissionRequests) {
    const ALLOWED_TOOLS = new Set([
      'Read',
      'Glob',
      'Grep',
      'LS',
      'WebFetch',
      'WebSearch',
      'TodoWrite',
      'TodoRead',
    ]);
    const REVIEWER_MCP_TOOLS = new Set([
      'mcp__baguette__PrRead',
      'mcp__baguette__PrComments',
      'mcp__baguette__PrComment',
      'mcp__baguette__PrWorkflows',
      'mcp__baguette__PrWorkflowLogs',
      'mcp__baguette__GitDiff',
      'mcp__baguette__ShowDiff',
    ]);
    // Reuse the full approval flow for AskUserQuestion so the user sees the question in the UI
    const askUserQuestionHandler = this.createCanUseTool(sessionId, userId, permissionRequests);

    return async (toolName, input, ctx) => {
      if (toolName === 'AskUserQuestion') {
        return askUserQuestionHandler(toolName, input, ctx);
      }
      if (ALLOWED_TOOLS.has(toolName) || REVIEWER_MCP_TOOLS.has(toolName)) {
        return { behavior: 'allow', updatedInput: input };
      }
      return {
        behavior: 'deny',
        message: `'${toolName}' is not available in reviewer mode.`,
      };
    };
  }

  createCanUseTool(sessionId, userId, permissionRequests) {
    const app = this.app;
    return async (toolName, input, { signal }) => {
      // Auto-allow all baguette MCP tools without showing approval UI
      if (toolName.startsWith('mcp__baguette__')) {
        return { behavior: 'allow', updatedInput: input };
      }

      const requestId = crypto.randomUUID();

      await app
        .service('sessions')
        .patch(sessionId, { status: 'approval' }, { user: { id: userId } });
      const approvalEvent = {
        requestId,
        sessionId,
        toolName,
        input,
        user_id: userId,
      };
      app.service('sessions').emit('permission:request', approvalEvent);

      return new Promise((resolve, reject) => {
        const onAbort = () => {
          permissionRequests.delete(requestId);
          reject(new Error('Aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        const resolver = async (decision) => {
          signal.removeEventListener('abort', onAbort);
          permissionRequests.delete(requestId);

          await app
            .service('sessions')
            .patch(sessionId, { status: 'running' }, { user: { id: userId } });

          if (decision.approved) {
            const updatedInput =
              toolName === 'AskUserQuestion' && decision.answers
                ? { ...input, answers: decision.answers }
                : input;
            resolve({ behavior: 'allow', updatedInput });
          } else {
            resolve({
              behavior: 'deny',
              message: decision.reason || 'Denied by user',
            });
          }
        };
        permissionRequests.set(requestId, { resolve: resolver, toolName, input, approvalEvent });
      });
    };
  }

  async injectBaguetteMessage(sessionState, { title, content }) {
    const { sessionId, channel } = sessionState;
    const app = this.app;
    const msg = {
      type: 'user',
      message: { role: 'user', content },
      title,
    };

    await app.service('messages').create({
      session_id: sessionId,
      type: 'user',
      subtype: 'baguette',
      message_json: JSON.stringify(msg),
    });

    channel.push(msg);
  }

  /**
   * Shared setup for both createSession and resumeSession: builds the
   * channel, query instance, session state, and kicks off the
   * message-processing loop.
   */
  async _startAgentLoop({ sessionId, sessionRow, user, stateOverrides = {} }) {
    const model = sessionRow.model || getAgentModelFromUser(user);
    const channel = createMessageChannel();
    const permissionRequests = new Map();
    const abortController = new AbortController();
    const isReviewer = sessionRow.agent_type === 'reviewer';

    const canUseTool = isReviewer
      ? this.createReviewerCanUseTool(sessionId, sessionRow.user_id, permissionRequests)
      : this.createCanUseTool(sessionId, sessionRow.user_id, permissionRequests);
    const allowedTools = isReviewer ? [] : commandsToAllowedTools(getAllowedCommandsFromUser(user));

    const claudeEnv = await this.app.service('sessions').getClaudeEnv(sessionId);
    const mcpServer = buildBaguetteMcpServer(sessionId, sessionRow.user_id, sessionRow, this.app);
    const queryInstance = query({
      prompt: channel,
      options: isReviewer
        ? await buildReviewerQueryOptions(sessionRow, {
            canUseTool,
            env: claudeEnv,
            model,
            abortController,
            mcpServer,
          })
        : await buildQueryOptions(sessionRow, {
            canUseTool,
            env: claudeEnv,
            model,
            abortController,
            allowedTools,
            mcpServer,
          }),
    });

    const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow.worktree_path) || '';
    const sessionState = {
      sessionId,
      userId: sessionRow.user_id,
      repoFullName: sessionRow.repo_full_name,
      branch: sessionRow.base_branch,
      absoluteWorktreePath,
      repoId: sessionRow.repo_id,
      agentType: sessionRow.agent_type || 'builder',
      token: getEffectiveGithubToken(user),
      channel,
      queryInstance,
      permissionRequests,
      abortController,
      ...stateOverrides,
    };

    this._activeSessions.set(sessionId, sessionState);

    this.processMessages(sessionState).catch((err) => {
      logger.error({ sessionId }, err.message);
    });

    return sessionState;
  }

  async resumeSession(sessionId) {
    const db = this.app.get('db');
    const sessionRow = await db('sessions').where({ id: sessionId }).first();
    if (!sessionRow) throw new Error('Session not found');
    if (!sessionRow.claude_session_id) throw new Error('No Claude session to resume');

    const user = await db('users').where({ id: sessionRow.user_id }).first();

    const sessionState = await this._startAgentLoop({
      sessionId,
      sessionRow,
      user,
      stateOverrides: { claudeSessionId: sessionRow.claude_session_id },
    });

    logger.info({ sessionId, claudeSessionId: sessionRow.claude_session_id }, 'Resumed session');

    return sessionState;
  }

  async ensureActiveSession(sessionId) {
    const existing = this._activeSessions.get(sessionId);
    if (existing) return existing;

    if (!this._resumePromises.has(sessionId)) {
      const promise = this.resumeSession(sessionId).finally(() => {
        this._resumePromises.delete(sessionId);
      });
      this._resumePromises.set(sessionId, promise);
    }

    return this._resumePromises.get(sessionId);
  }

  async processMessages(sessionState) {
    const { queryInstance, sessionId, userId } = sessionState;
    const db = this.app.get('db');

    try {
      for await (const message of queryInstance) {
        if (message.type === 'system' && message.subtype === 'init') {
          await db('sessions')
            .where({ id: sessionId })
            .update({ claude_session_id: message.session_id });
          sessionState.claudeSessionId = message.session_id;
        }

        if (message.isReplay) continue;
        if (isHumanUserMessage(message)) continue;

        await this.persistMessage(sessionState, message);

        // One agent “turn” ends here. We exit the stream loop; teardown always runs once in `finally`.
        if (message.type === 'result') {
          if (message.subtype === 'success' && !message.is_error) {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'completed' }, { user: { id: userId } });
          } else {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
          }
          break;
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error({ sessionId }, 'Session stream error');
        logger.error(err, 'Session stream error');
        await this.app
          .service('sessions')
          .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
        const userFacing =
          err.message === SDK_QUERY_CLOSED_MESSAGE
            ? 'Agent connection closed before the response finished. Try sending your message again.'
            : err.message;
        try {
          await this._persistSessionStatusMessage(sessionId, userId, userFacing);
        } catch (persistErr) {
          logger.warn(
            { sessionId, err: persistErr.message },
            'Failed to persist session error status'
          );
        }
        this.app
          .service('sessions')
          .emit('app:error', { sessionId, message: userFacing, user_id: userId });
      }
    } finally {
      // Single dispose path: success (`break` after `result`), stream error, or abort — avoids double-close
      // and keeps deferred `queryInstance.close()` logic in one place.
      try {
        await this._disposeActiveSession(sessionId);
      } catch (disposeErr) {
        logger.warn({ sessionId, err: disposeErr?.message }, 'claude-agent dispose failed');
      }
    }
  }

  async sendMessage(sessionId, content) {
    const session = await this.ensureActiveSession(sessionId);
    const db = this.app.get('db');

    await this.app
      .service('sessions')
      .patch(sessionId, { status: 'running' }, { user: { id: session.userId } });

    const sessionRow = await db('sessions').where({ id: sessionId }).first();
    const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow?.worktree_path);
    if (sessionRow?.remote_branch && absoluteWorktreePath && session.token) {
      try {
        const hasNew = await remoteHasNewCommits(
          absoluteWorktreePath,
          sessionRow.remote_branch,
          session.token,
          session.repoFullName
        );
        if (hasNew) {
          await this.injectBaguetteMessage(session, {
            title: 'Syncing with remote',
            content:
              'There are new commits on the remote branch. Please pull the latest changes, ' +
              'resolve any merge conflicts, and commit the merge before we proceed.',
          });
        }
      } catch (err) {
        logger.error(err, 'Remote check error (non-fatal)');
      }
    }

    const sdkMessage = { type: 'user', message: { role: 'user', content } };
    await db('session_messages').insert({
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify(sdkMessage),
    });

    session.channel.push({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  async resolvePermission(sessionId, requestId, decision) {
    const session = await this.ensureActiveSession(sessionId);
    if (!session) return false;

    const entry = session.permissionRequests.get(requestId);
    if (!entry) return false;

    entry.resolve(decision);
    return true;
  }

  syncSessionSettingsFromPatch(sessionId, sessionRow) {
    const session = this.getActiveSession(sessionId);
    if (!session?.queryInstance) return;
    const effectiveMode = sessionRow.plan_mode ? 'plan' : sessionRow.permission_mode;
    session.queryInstance.setPermissionMode(effectiveMode);
    session.queryInstance.setModel(sessionRow.model);
  }

  async stopSession(sessionId) {
    await this._disposeActiveSession(sessionId);
  }

  async generateSessionMetadata(initialPrompt, shortId = '', user) {
    const fallbackBranch = `task-${shortId}`;
    const prompt = `Generate metadata for a coding task. Output ONLY a JSON object with no markdown or explanation:
- "label": very short label (max 50 chars) summarizing the task
- "branch": short kebab-case git branch name suffixed with "-${shortId}" (e.g. "fix-auth-token-${shortId}"), max 60 chars

Task: ${initialPrompt}`;

    let label = '';
    let branchName = fallbackBranch;

    const env = buildClaudeEnvFromUser(user);
    for await (const message of query({
      prompt,
      options: { model: getModelId('haiku'), env },
    })) {
      if (message.type === 'result' && message.subtype === 'success' && !message.is_error) {
        const text = (message.result || '').trim();
        try {
          const jsonText = text
            .replace(/^```(?:json)?\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
          const parsed = JSON.parse(jsonText);
          label = (parsed.label || '').slice(0, 80);
          branchName = (parsed.branch || fallbackBranch)
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 60);
        } catch {
          label = text.slice(0, 80);
        }
      }
    }

    return { label, branchName };
  }

  async persistMessage(sessionState, message) {
    const { sessionId, userId } = sessionState;
    const app = this.app;

    await app.service('messages').create(
      {
        session_id: sessionId,
        type: message.type,
        subtype: message.subtype ?? null,
        uuid: message.uuid ?? null,
        message_json: JSON.stringify(message),
        total_cost_usd: message.type === 'result' ? (message.total_cost_usd ?? null) : null,
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  // Required by @feathersjs/express to recognise this as a Feathers service
  // rather than Express middleware.
  async get(id) {
    return this.getActiveSession(id) ?? null;
  }
}

export function registerClaudeAgentService(app, path = 'claude-agent') {
  app.use(path, new ClaudeAgentService(), {
    methods: [
      'createAgentSession',
      'resumeSession',
      'ensureActiveSession',
      'sendMessage',
      'resolvePermission',
      'stopSession',
      'syncSessionSettingsFromPatch',
      'onMessageCreated',
    ],
  });
}
