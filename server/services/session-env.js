import { loadBaguetteConfig, interpolateEnv } from './baguette-config.js';
import { getAnthropicApiKeyFromUser } from './agent-settings.js';
import { getPreviewHost } from './preview.js';

const SERVER_ONLY_ENV_KEYS = [
  'NODE_ENV',
  'ENCRYPTION_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'DATA_DIR',
  'PUBLIC_HOST',
  'PUBLIC_API_HOST',
];

function stripServerEnv(env) {
  const result = { ...env };
  for (const key of SERVER_ONLY_ENV_KEYS) delete result[key];
  return result;
}

/**
 * Build the environment for task subprocesses (init/cleanup scripts, dev servers).
 * Includes interpolated .baguette.yaml env vars and user secrets, but NOT
 * the Anthropic API key or git identity (those are for the Claude agent only).
 */
export async function buildTaskEnv(db, sessionId) {
  const session = await db('sessions').where({ id: sessionId }).first();
  const secretRows = await db('secrets').select('key', 'value');
  const secrets = Object.fromEntries(secretRows.map((r) => [r.key, r.value]));

  let sessionEnv = {};
  if (session?.worktree_path) {
    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    if (baguetteConfig?.session?.env && typeof baguetteConfig.session.env === 'object') {
      sessionEnv = interpolateEnv(baguetteConfig.session.env, {
        shortId: session.short_id,
        secrets,
        publicUri: getPreviewHost(session.short_id),
      });
    }
  }

  return {
    ...stripServerEnv(process.env),
    ...sessionEnv,
  };
}

/**
 * Build Claude subprocess env from a user row (no DB lookup).
 * Used when there is no session id yet (e.g. metadata generation during session create).
 */
export function buildClaudeEnvFromUser(user) {
  const apiKey = getAnthropicApiKeyFromUser(user);
  const gitName = user?.username || 'baguette';
  const gitEmail =
    user?.email ||
    (user?.github_id && user?.username
      ? `${user.github_id}+${user.username}@users.noreply.github.com`
      : 'baguette@users.noreply.github.com');
  return {
    ...stripServerEnv(process.env),
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    GIT_AUTHOR_NAME: gitName,
    GIT_AUTHOR_EMAIL: gitEmail,
    GIT_COMMITTER_NAME: gitName,
    GIT_COMMITTER_EMAIL: gitEmail,
  };
}

/**
 * Build the environment for the Claude agent subprocess.
 * Includes the Anthropic API key and git author/committer identity
 * derived from the session's owner.
 */
export async function buildClaudeEnv(db, sessionId) {
  const session = await db('sessions').where({ id: sessionId }).first();
  const user = session ? await db('users').where({ id: session.user_id }).first() : null;
  return buildClaudeEnvFromUser(user);
}
