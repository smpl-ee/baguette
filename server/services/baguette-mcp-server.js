import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getEffectiveGithubToken } from './agent-settings.js';
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
  addReactionToComment,
} from './github.js';
import { loadBaguetteConfig, getAvailableCommands } from './baguette-config.js';
import loadPrompt from '../prompts/loadPrompt.js';
import { DOCKER_COMPOSE_PATH, resolveDataDirRelativePath } from '../config.js';

const execFileAsync = promisify(execFile);

function ok(data) {
  // Pretty-print so spilled tool-result files are multi-line; line-based Read offset/limit can paginate.
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...data }, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }, null, 2) }] };
}

/** Split stream text into lines for JSON arrays (drops trailing empty segment from final newline). */
function streamToLines(text) {
  if (text === '' || text == null) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Annotates unified diff output with absolute new-file line numbers so the
 * agent can directly reference them for inline comments without counting.
 *
 * Format: each added/context line gets a `L<n>:` prefix showing the new-file
 * line number. Removed lines get `(del):` since they no longer exist in HEAD.
 * Hunk headers (`@@ ... @@`) are preserved unchanged.
 */
function annotateWithLineNumbers(diffText) {
  const lines = diffText.split('\n');
  const out = [];
  let newLine = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) newLine = parseInt(m[1], 10);
      out.push(line);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push(`L${newLine}: ${line}`);
      newLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      out.push(`(del): ${line}`);
    } else if (line.startsWith(' ')) {
      out.push(`L${newLine}: ${line}`);
      newLine++;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

export function buildBaguetteMcpServer(session, app) {
  const db = app.get('db');

  const getSession = async () => {
    const row = await db('sessions').where({ id: session.id }).first();
    if (row) {
      session = row;
      return row;
    }
    return session;
  };

  const getToken = async () => {
    const user = await app.service('users').get(session.user_id, {});
    return getEffectiveGithubToken(user);
  };

  const patchSession = async (data) => {
    const updated = await app.service('sessions').patch(session.id, data);
    session = { ...session, ...updated };
  };

  const absoluteWorktreePath = resolveDataDirRelativePath(session.worktree_path) || '';
  const { base_branch: baseBranch } = session;

  return createSdkMcpServer({
    name: 'baguette',
    tools: [
      // ── Git ────────────────────────────────────────────────────────────────

      tool(
        'GitPull',
        'Pull latest changes from the remote branch into the current worktree.',
        {},
        async () => {
          if (!session?.remote_branch) return ok({ message: 'No remote branch to pull.' });
          const result = await gitPull(
            absoluteWorktreePath,
            session.remote_branch,
            await getToken()
          );
          return ok(result);
        }
      ),

      tool('GitPush', 'Push the current branch to origin and set upstream.', {}, async () => {
        if (!session.auto_push) {
          return ok({
            message:
              'Auto-push is disabled. Changes have been committed locally. The user can push manually or enable auto-push using the controls at the bottom of the chat.',
          });
        }
        let result;
        try {
          result = await gitPush(absoluteWorktreePath, await getToken());
        } catch (err) {
          if (err.rejected) return fail(err.message);
          throw err;
        }
        await patchSession({ remote_branch: result.branch, created_branch: result.branch });
        return ok(result);
      }),

      tool(
        'GitFetch',
        'Fetch a branch from origin without modifying the working tree.',
        { branch: z.string().describe('Branch name to fetch') },
        async ({ branch }) => {
          const result = await gitFetch(absoluteWorktreePath, await getToken(), branch);
          return ok(result);
        }
      ),

      // ── PR info ────────────────────────────────────────────────────────────

      tool('PrRead', 'Get the current PR info: URL, number, and branch.', {}, async () => {
        const result = {
          pr_url: session?.pr_url ?? null,
          pr_number: session?.pr_number ?? null,
          branch: session?.remote_branch || session?.created_branch || null,
        };
        if (!result.pr_url) {
          result.message =
            'No pull request exists yet. Push your changes first with GitPush, then create one with PrUpsert.';
        }
        return ok(result);
      }),

      tool(
        'PrUpsert',
        'Create or update the pull request with a title and description.',
        {
          title: z.string().describe('PR title'),
          description: z.string().optional().describe('PR body / description (markdown)'),
        },
        async ({ title, description = '' }) => {
          // Always persist label and description to session regardless of auto_push
          await patchSession({ label: title, pr_description: description });
          if (!session.auto_push) {
            return ok({
              message:
                'Auto-push is disabled. The PR has not been created/updated on GitHub. The user can push manually or enable auto-push using the controls at the bottom of the chat.',
            });
          }
          let head = null;
          if (!session.pr_number) {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
              cwd: absoluteWorktreePath,
            });
            head = stdout.trim();
            if (head === 'HEAD') {
              return fail(
                'Cannot create a pull request from a detached HEAD. Check out a branch first.'
              );
            }
            const token = await getToken();
            const existing = token ? await getOpenPR(token, session.repo_full_name, head) : null;
            if (existing) {
              await patchSession({
                pr_url: existing.html_url,
                pr_number: existing.number,
                pr_status: existing.draft ? 'draft' : 'open',
                label: existing.title,
              });
              return fail(
                `A pull request already exists for branch "${head}" (#${existing.number}). ` +
                  'The session was updated with this PR. Call PrRead again, and PrUpsert to update the title and description if needed.'
              );
            }
          }
          // Re-read session since we may have patched it above
          const pr = await upsertPR(await getToken(), {
            repoFullName: session.repo_full_name,
            prNumber: session.pr_number,
            title,
            body: description,
            head,
            baseBranch: session.base_branch,
          });
          if (!session.pr_number) {
            await patchSession({
              pr_url: pr.url,
              pr_number: pr.number,
              pr_status: 'open',
            });
          }
          return ok({ url: pr.url, number: pr.number });
        }
      ),

      // ── PR comments & review ───────────────────────────────────────────────

      tool(
        'PrComments',
        'List PR conversation comments and inline review comments on the diff.',
        {},
        async () => {
          const session = await getSession();
          if (!session?.pr_number) {
            return fail(
              'No pull request associated with this session. Create one first with PrUpsert.'
            );
          }
          const result = await getPRComments(
            await getToken(),
            session.repo_full_name,
            session.pr_number
          );
          return ok(result);
        }
      ),

      tool(
        'PrMarkCommentViewed',
        'Mark a PR comment as viewed by adding a 👀 eyes reaction on GitHub. Viewed comments are excluded from future PrComments results. Use the comment id from PrComments output.',
        {
          commentId: z.number().int().describe('Comment ID from PrComments'),
          commentType: z
            .enum(['issue', 'review'])
            .describe('"issue" for conversation thread comments, "review" for inline review comments'),
        },
        async ({ commentId, commentType }) => {
          const session = await getSession();
          if (!session?.pr_number) return fail('No pull request associated with this session.');
          const result = await addReactionToComment(
            await getToken(),
            session.repo_full_name,
            commentId,
            commentType
          );
          return ok({ reactionId: result.id, content: result.content });
        }
      ),

      tool(
        'PrComment',
        'Post a comment on the pull request. Omit path/line for a general PR comment; provide both to post an inline comment on a specific line.',
        {
          body: z.string().describe('Comment text (markdown supported)'),
          path: z
            .string()
            .optional()
            .describe('File path for an inline comment (relative to repo root)'),
          line: z.coerce
            .number()
            .int()
            .optional()
            .describe('Line number in the file for an inline comment (integer)'),
          side: z
            .enum(['LEFT', 'RIGHT'])
            .optional()
            .describe(
              'Which side of the diff: RIGHT for added/context lines (new file), LEFT for deleted lines (old file). Defaults to RIGHT.'
            ),
        },
        async ({ body, path: filePath, line, side }) => {
          const session = await getSession();
          if (!session?.pr_number) return fail('No pull request associated with this session.');
          const token = await getToken();
          if (filePath && line) {
            const { stdout: commitId } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
              cwd: absoluteWorktreePath,
            });
            const comment = await createPRLineComment(
              token,
              session.repo_full_name,
              session.pr_number,
              {
                body,
                path: filePath,
                line,
                commitId: commitId.trim(),
                side,
              }
            );
            return ok(comment);
          }
          const comment = await createPRComment(
            token,
            session.repo_full_name,
            session.pr_number,
            body
          );
          return ok(comment);
        }
      ),

      tool(
        'PrReview',
        'Submit a pull request review decision. Pass inline comments via the `comments` array to have them posted as part of the review rather than as standalone comments.',
        {
          event: z
            .enum(['approve', 'request-changes', 'comment'])
            .describe('Review decision: approve, request-changes, or comment'),
          body: z.string().describe('Review summary message'),
          comments: z
            .array(
              z.object({
                body: z.string().describe('Comment text (markdown supported)'),
                path: z.string().describe('File path relative to repo root'),
                line: z.coerce.number().int().describe('Line number in the file'),
                side: z
                  .enum(['LEFT', 'RIGHT'])
                  .optional()
                  .describe(
                    'Which side of the diff: RIGHT for added/context lines (default), LEFT for deleted lines.'
                  ),
              })
            )
            .optional()
            .describe('Inline comments to include as part of the review'),
        },
        async ({ event, body, comments = [] }) => {
          const eventMap = {
            approve: 'APPROVE',
            'request-changes': 'REQUEST_CHANGES',
            comment: 'COMMENT',
          };
          const session = await getSession();
          if (!session?.pr_number) return fail('No pull request associated with this session.');

          let commitId = null;
          if (comments.length > 0) {
            const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
              cwd: absoluteWorktreePath,
            });
            commitId = stdout.trim();
          }

          const review = await createPRReview(
            await getToken(),
            session.repo_full_name,
            session.pr_number,
            eventMap[event],
            body,
            comments,
            commitId
          );
          return ok(review);
        }
      ),

      // ── CI ─────────────────────────────────────────────────────────────────

      tool('PrWorkflows', 'Get CI workflow run status for the PR branch.', {}, async () => {
        const session = await getSession();
        const branch = session?.remote_branch || session?.created_branch;
        if (!branch) return ok({ runs: [], message: 'No branch available for this session.' });
        const runs = await getPRWorkflows(await getToken(), session.repo_full_name, branch);
        return ok({ runs });
      }),

      tool(
        'PrWorkflowLogs',
        'Get logs for a workflow run. Defaults to the last 8000 bytes (where errors appear). Use startByte to read earlier sections; the response includes totalBytes for pagination.',
        {
          runId: z.string().describe('Workflow run ID from PrWorkflows'),
          startByte: z.number().optional().describe('Start byte offset for partial log fetch'),
          endByte: z.number().optional().describe('End byte offset for partial log fetch'),
        },
        async ({ runId, startByte, endByte }) => {
          const session = await getSession();
          const result = await getPRWorkflowLogs(await getToken(), session.repo_full_name, runId, {
            startByte,
            endByte,
          });
          return ok(result);
        }
      ),

      // ── Project commands ───────────────────────────────────────────────────

      tool(
        'ListProjectCommands',
        'List available project commands defined in .baguette.yaml (tests, linters, migrations, etc.).',
        {},
        async () => {
          let cfg;
          try {
            cfg = await loadBaguetteConfig(session.worktree_path);
            if (cfg?.error) throw new Error(cfg.error);
          } catch (err) {
            return fail(err.message);
          }
          if (!cfg) {
            return ok({
              commands: [],
              message:
                'No .baguette.yaml config found. Run ConfigRepoPrompt and follow the instructions.',
            });
          }
          const commands = getAvailableCommands(cfg).filter(
            (c) => c && typeof c.label === 'string' && typeof c.run === 'string'
          );
          return ok({ commands });
        }
      ),

      tool(
        'RunProjectCommand',
        'Run a project command by its label from .baguette.yaml (e.g. "Run tests"). Always use this instead of running scripts directly. Pass args to scope execution: a file path, a test name pattern, or any flag the underlying runner supports (e.g. ["src/foo.test.js"], ["--grep", "my test"], ["-k", "my_test"]). Output is returned as stdoutLines/stderrLines (one terminal line per JSON line).',
        {
          label: z.string().describe('Command label exactly as returned by ListProjectCommands'),
          args: z
            .array(z.string())
            .optional()
            .describe(
              'Extra arguments appended to the command (e.g. a test file path, name pattern, or CLI flag)'
            ),
        },
        async ({ label, args = [] }) => {
          let commands;
          try {
            const cfg = await loadBaguetteConfig(session.worktree_path);
            if (cfg?.error) throw new Error(cfg.error);
            commands = cfg ? getAvailableCommands(cfg) : null;
          } catch (err) {
            return fail(err.message);
          }

          if (!commands) return fail('.baguette.yaml not found');

          const commandConfig = commands.find((c) => c && c.label === label);
          if (!commandConfig || typeof commandConfig.run !== 'string') {
            return fail(`Unknown command label: ${label}`);
          }

          const combined = `${commandConfig.run} ${args.join(' ')}`.trim();
          let stdout = '';
          let stderr = '';

          return new Promise((resolve) => {
            app
              .service('tasks')
              .create(
                {
                  session_id: session.id,
                  command: combined,
                  label,
                  onLog: (id, stream, data) => {
                    if (stream === 'stdout') stdout += data;
                    else stderr += data;
                  },
                  onExit: (id, exitCode) =>
                    resolve(
                      ok({
                        exitCode,
                        stdoutLines: streamToLines(stdout),
                        stderrLines: streamToLines(stderr),
                      })
                    ),
                },
                { user: { id: session.user_id } }
              )
              .catch((err) => resolve(fail(err.message)));
          });
        }
      ),

      // ── Repo config ─────────────────────────────────────────────────────────

      tool(
        'ConfigRepoPrompt',
        'Get the onboarding instructions for configuring this repository (.baguette.yaml setup).',
        {},
        async () => {
          const prompt = await loadPrompt('onboarding-prompt', { DOCKER_COMPOSE_PATH });
          const interactivePrompt = await loadPrompt('onboarding-interactive-prompt');
          return ok({ prompt: [prompt, interactivePrompt].join('\n\n') });
        }
      ),

      tool(
        'ConfigRepoStart',
        'Start a new session dedicated to configuring .baguette.yaml for this repository.',
        {},
        async () => {
          const session = await getSession();
          const repo = await db('repos').where({ id: session.repo_id }).first();
          const prompt = await loadPrompt('onboarding-prompt', { DOCKER_COMPOSE_PATH });
          const newSession = await app.service('sessions').create(
            {
              repo_full_name: session.repo_full_name,
              base_branch: repo.default_branch,
              initial_prompt: prompt,
            },
            { provider: undefined, user: { id: session.user_id } }
          );
          const sessionPath = `/sessions/${newSession.id}`;
          return ok({
            sessionId: newSession.id,
            sessionPath,
            message: `Configuration session started: ${sessionPath}`,
          });
        }
      ),

      // ── Diff ───────────────────────────────────────────────────────────────

      tool(
        'GitDiff',
        'Run git diff relative to the merge-base with the base branch. Automatically computes the correct merge-base so diffs show only changes introduced by this branch.',
        {
          args: z
            .array(z.string())
            .optional()
            .describe(
              'Extra git diff arguments, e.g. ["--name-only"] to list changed files, or ["--", "path/to/file"] for a specific file.'
            ),
        },
        async ({ args = [] }) => {
          const ref = baseBranch ? `origin/${baseBranch}` : null;
          const mergeBase = ref
            ? await execFileAsync('git', ['merge-base', 'HEAD', ref], { cwd: absoluteWorktreePath })
                .then((r) => r.stdout.trim())
                .catch(() => null)
            : null;
          const base = mergeBase || 'HEAD~1';
          const rawDiff = await execFileAsync('git', ['diff', base, 'HEAD', ...args], {
            cwd: absoluteWorktreePath,
            maxBuffer: 5 * 1024 * 1024,
          })
            .then((r) => r.stdout)
            .catch((err) => err.stdout || '');
          // Annotate with line numbers unless using summary flags
          const isSummary = args.some((a) =>
            ['--name-only', '--name-status', '--stat', '--shortstat'].includes(a)
          );
          const diff = rawDiff && !isSummary ? annotateWithLineNumbers(rawDiff) : rawDiff;
          return ok({ diff: diff || '(no changes)', base });
        }
      ),

      // ── Diff display ───────────────────────────────────────────────────────

      tool(
        'ShowDiff',
        'Display the git diff for a file visually to the user in a diff viewer.',
        { path: z.string().describe('File path (relative to worktree root) to show diff for') },
        async ({ path: filePath }) => {
          // Diff is fetched client-side via sessionsService.showDiff — nothing returned to agent
          return ok({ path: filePath });
        }
      ),
    ],
  });
}
