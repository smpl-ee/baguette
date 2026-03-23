import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import logger from '../logger.js';
import { resolveDataDirRelativePath } from '../config.js';

const CONFIG_FILENAME = '.baguette.yaml';

/**
 * @param {string|null|undefined} worktreePath - Absolute path, or path relative to DATA_DIR (as stored on sessions).
 */
export async function loadBaguetteConfig(worktreePath) {
  const absoluteWorktreePath = resolveDataDirRelativePath(worktreePath);
  if (!absoluteWorktreePath) return null;
  const configPath = path.join(absoluteWorktreePath, CONFIG_FILENAME);
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    const content = yaml.load(raw);
    return content.config ?? {};
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    logger.error(err, 'Failed to load %s', CONFIG_FILENAME);
    return { error: `Failed to load ${CONFIG_FILENAME}: ${err.message}` };
  }
}

const PLACEHOLDER_REGEX = /\$\{\{\s*baguette\.secrets\.([A-Za-z0-9_]+)\s*\}\}/g;
const SHORT_ID_REGEX = /\$\{\{\s*baguette\.session\.shortId\s*\}\}/g;
const PUBLIC_URI_REGEX = /\$\{\{\s*baguette\.session\.public_uri\s*\}\}/g;

export function interpolateEnv(template, { shortId, secrets, publicUri }) {
  if (!template || typeof template !== 'object') return {};

  const result = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value !== 'string') continue;
    let interpolated = value
      .replace(PLACEHOLDER_REGEX, (_, secretKey) => secrets[secretKey] ?? '')
      .replace(SHORT_ID_REGEX, shortId ?? '')
      .replace(PUBLIC_URI_REGEX, publicUri);
    result[key] = interpolated;
  }
  return result;
}

/**
 * Extract the webserver config from a host config.
 * Returns null if not defined.
 */
export function getWebserverConfig(baguetteConfig) {
  return baguetteConfig?.webserver ?? null;
}

/**
 * Extract a multi-line script block as a single shell command (lines joined with &&).
 * Returns null if the block is empty or missing.
 */
export function getScriptCommand(block) {
  if (!block || typeof block !== 'string') return null;
  const lines = block
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return lines.join(' && ');
}

/**
 * Build the full list of available commands from a baguette config.
 * Order: Init (if defined), Dev Server (if defined), then user-defined commands.
 */
export function getAvailableCommands(baguetteConfig) {
  const commands = [];
  const initScript = getScriptCommand(baguetteConfig?.session?.init);
  if (initScript) commands.push({ label: 'baguette:init', run: initScript });

  const webserver = getWebserverConfig(baguetteConfig);
  if (webserver?.command) {
    commands.push({
      label: 'baguette:webserver',
      run: webserver.command,
      ports: webserver.ports || [],
    });
  }

  const base = baguetteConfig?.session?.commands || [];
  commands.push(...base);
  return commands;
}
