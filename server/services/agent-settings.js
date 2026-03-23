import { decrypt } from '../lib/encrypt.js';

export const SYSTEM_ALLOWED_COMMANDS = [
  'git commit',
  'git add',
  'git merge',
  'grep',
  'rg',
  'cat',
  'head',
  'tail',
  'find',
  'ls',
  'wc',
];

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MODE = 'default';

export function getAgentModelFromUser(user) {
  return user?.model || DEFAULT_MODEL;
}

export function getDefaultPermissionModeFromUser(user) {
  return user?.default_permission_mode || DEFAULT_MODE;
}

export function getAllowedCommandsFromUser(user) {
  let userCmds = [];
  if (user?.allowed_commands) {
    try {
      const parsed =
        typeof user.allowed_commands === 'string'
          ? JSON.parse(user.allowed_commands)
          : user.allowed_commands;
      if (Array.isArray(parsed)) userCmds = parsed;
    } catch {
      /* ignore */
    }
  }
  return [...SYSTEM_ALLOWED_COMMANDS, ...userCmds];
}

// Use PAT if set (plain or encrypted), otherwise fall back to OAuth access_token
export function getEffectiveGithubToken(user) {
  if (user?.github_token) return user.github_token; // plain (hook-processed)
  if (user?.github_token_encrypted) {
    try {
      return decrypt(user.github_token_encrypted);
    } catch {
      /* ignore */
    }
  }
  return user?.access_token || null;
}

export function getAnthropicApiKeyFromUser(user) {
  if (user?.anthropic_api_key) return user.anthropic_api_key; // plain (hook-processed)
  if (user?.anthropic_api_key_encrypted) {
    try {
      return decrypt(user.anthropic_api_key_encrypted);
    } catch {
      return null;
    }
  }
  return null;
}
