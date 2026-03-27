import { loadBaguetteConfig } from './baguette-config.js';
import loadPrompt from '../prompts/loadPrompt.js';
import { resolveDataDirRelativePath } from '../config.js';

/**
 * Builds the end-of-turn Git/PR instructions injected into the system prompt.
 * Handles SQLite booleans (stored as 0/1) via truthy/falsy checks.
 */
export function buildTurnEndInstructions(session) {
  if (!session.auto_push) {
    return 'Do NOT commit or push changes at the end of turns. The user will commit and push manually.';
  }
  const prStep = session.auto_create_pr
    ? '4. If there is no PR open, create one. If the user did not request you to make code changes, confirm with AskUserQuestion first.'
    : '4. Do NOT create a pull request. The user will create it manually.';
  return `At the end of every turn, if there are uncommitted changes:\n\n1. Stage and commit: always use \`git add -A && git commit -m "concise message"\` — never stage individual files, to ensure nothing is missed.\n2. Push to remote:\n   Call the \`GitPush\` tool.\n3. Check if there is a current PR and if its title/body reflects the final changes. Otherwise call:\n   \`PrUpsert\` with \`title\` and \`description\`.\n${prStep}`;
}

/**
 * Builds the full system prompt append string for a builder session.
 * Returns the rendered build-prompt.md template with all variables substituted.
 */
export async function buildSystemPromptAppend(sessionRow) {
  const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow.worktree_path) || '';
  const hasBaguetteYaml = Boolean(await loadBaguetteConfig(sessionRow.worktree_path));
  const baguetteConfigNotice = hasBaguetteYaml
    ? ''
    : '**IMPORTANT**: this project has no .baguette.yaml config file. Call the `ConfigRepoPrompt` tool before tackling the requested task, read the returned prompt and proceed accordingly.\n\n';

  return loadPrompt('build-prompt', {
    base_branch: sessionRow.base_branch,
    worktree_path: absoluteWorktreePath,
    baguette_config_notice: baguetteConfigNotice,
    turn_end_instructions: buildTurnEndInstructions(sessionRow),
    base_prompt: await loadPrompt('base-prompt', {
      worktree_path: absoluteWorktreePath,
      working_directory_restrictions:
        'Work exclusively within your current working directory. Do not read, edit, search files or run any shell command outside of it.',
    }),
  });
}

/**
 * Builds the full system prompt append string for a reviewer session.
 * Returns the rendered reviewer-prompt.md template with all variables substituted.
 */
export async function buildReviewerSystemPromptAppend(sessionRow) {
  const absoluteWorktreePath = resolveDataDirRelativePath(sessionRow.worktree_path) || '';
  return loadPrompt('reviewer-prompt', {
    worktree_path: absoluteWorktreePath,
    pr_number: String(sessionRow.pr_number || ''),
    repo_full_name: sessionRow.repo_full_name || '',
    base_prompt: await loadPrompt('base-prompt', {
      worktree_path: absoluteWorktreePath,
      working_directory_restrictions:
        'Work exclusively within your current working directory. Do NOT modify, create, or delete any files.',
    }),
  });
}
